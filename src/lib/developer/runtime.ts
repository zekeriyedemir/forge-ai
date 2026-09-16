import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { projectForOwner } from "@/lib/access";
import { proposalSchema, featureBranch, safeTarget, shaSchema } from "./contracts";
import { DeveloperGitHubError, developerGitHub, type DeveloperGitHub } from "./github";
import { generateDeveloperProposal } from "./proposal";

export class DeveloperFlowError extends Error {}
const staleExecutionBefore = () => new Date(Date.now() - 15 * 60_000);

async function owner(projectId: string, userId: string) {
  if (!await projectForOwner(projectId, userId)) throw new DeveloperFlowError("Project not found or access denied.");
}

async function linkedRepository(projectId: string, repositoryId?: string, githubId?: bigint, fullName?: string) {
  const linked = await db.gitHubRepository.findUnique({ where: { projectId } });
  if (!linked || (repositoryId && linked.id !== repositoryId) || (githubId && linked.githubId !== githubId) || (fullName && linked.fullName !== fullName)) throw new DeveloperFlowError("The linked GitHub repository changed. Stop and create a new proposal.");
  return linked;
}

async function verifiedGitHub(projectId: string, userId: string, repositoryId?: string, client?: DeveloperGitHub, githubId?: bigint, fullName?: string) {
  const linked = await linkedRepository(projectId, repositoryId, githubId, fullName);
  const github = client ?? await developerGitHub(userId);
  const remote = await github.repository(linked.fullName);
  if (BigInt(remote.id) !== linked.githubId || remote.full_name !== linked.fullName) throw new DeveloperFlowError("Linked repository identity does not match GitHub.");
  if (remote.permissions?.push === false) throw new DeveloperFlowError("Your GitHub account cannot push to this repository.");
  return { linked, github, remote };
}

export async function createDeveloperProposal(projectId: string, taskId: string, userId: string, client?: DeveloperGitHub, generator = generateDeveloperProposal) {
  await owner(projectId, userId);
  const task = await db.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) throw new DeveloperFlowError("Task not found in this project.");
  const existing = await db.developerExecution.findFirst({ where: { projectId, taskId } });
  if (existing) return existing;
  const { linked, github, remote } = await verifiedGitHub(projectId, userId, undefined, client);
  const target = await github.ref(linked.fullName, "dev") ? "dev" : safeTarget(remote.default_branch);
  const baseSha = await github.ref(linked.fullName, target);
  if (!baseSha) throw new DeveloperFlowError("The target branch is missing.");
  const context = await github.context(linked.fullName, baseSha, `${task.title} ${task.description}`);
  const proposal = proposalSchema.parse(await generator(`${task.title}\n${task.description}`, context));
  const readable = new Map(context.files.map(file => [file.path, file.content]));
  const existingPaths = new Set(context.paths);
  if (proposal.files.some(file => existingPaths.has(file.path) && (!readable.has(file.path) || readable.get(file.path) === file.content))) throw new DeveloperFlowError("Proposal tried to replace an unread or unchanged file.");
  const id = crypto.randomUUID();
  const branch = featureBranch(task.title, id);
  try {
    return await db.$transaction(async tx => {
      const execution = await tx.developerExecution.create({ data: { id, projectId, taskId, runId: task.sourceRunId, repositoryId: linked.id, repositoryGithubId: linked.githubId, repositoryFullName: linked.fullName, branch, targetBranch: target, baseSha, proposal: proposal as Prisma.InputJsonValue, validationSummary: "Static path, size, and structured-output validation passed. Repository tests and CI have not run." } });
      await tx.approvalRequest.create({ data: { projectId, executionId: id, runId: task.sourceRunId, action: "IMPLEMENT", requestedById: userId, description: `Implement ${proposal.task} in ${linked.fullName} on ${branch}`, payload: { branch, target, baseSha, files: proposal.files.map(file => ({ path: file.path, reason: file.reason })), summary: proposal.summary, risks: proposal.risks, validationPlan: proposal.validationPlan } } });
      await tx.activityEvent.create({ data: { projectId, kind: "developer", message: `Developer proposal awaiting approval: ${proposal.task}` } });
      return execution;
    });
  } catch (error) {
    // The unique task constraint handles concurrent proposal requests without creating duplicate branches.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await db.developerExecution.findFirst({ where: { projectId, taskId } });
      if (winner) return winner;
    }
    throw error;
  }
}

export async function decideApproval(projectId: string, approvalId: string, userId: string, decision: "approve" | "reject") {
  await owner(projectId, userId);
  const approval = await db.approvalRequest.findFirst({ where: { id: approvalId, projectId }, include: { execution: true } });
  if (!approval) throw new DeveloperFlowError("Approval not found in this project.");
  if (approval.status !== "PENDING") throw new DeveloperFlowError("This approval has already been decided.");
  if (approval.action === "MERGE") {
    const pull = approval.execution;
    if (pull.status !== "PR_OPEN" || !pull.commitSha || !pull.pullNumber) throw new DeveloperFlowError("The implementation is not ready for merge approval.");
  }
  const changed = await db.approvalRequest.updateMany({ where: { id: approvalId, projectId, status: "PENDING" }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: userId, decidedAt: new Date() } });
  if (changed.count !== 1) throw new DeveloperFlowError("This approval was already decided.");
  await db.activityEvent.create({ data: { projectId, kind: "approval", message: `${approval.action.toLowerCase()} request ${decision === "approve" ? "approved" : "rejected"}` } });
  return approval.action;
}

async function claimApproval(projectId: string, approvalId: string, action: "IMPLEMENT" | "MERGE") {
  const approval = await db.approvalRequest.findFirst({ where: { id: approvalId, projectId, action } });
  if (!approval) throw new DeveloperFlowError("Approval not found.");
  if (approval.status === "EXECUTED") return false;
  const stale = approval.status === "EXECUTING" && approval.updatedAt < staleExecutionBefore();
  if (approval.status !== "APPROVED" && !stale) throw new DeveloperFlowError("Explicit approval is required before this operation.");
  const claimed = await db.approvalRequest.updateMany({ where: { id: approvalId, projectId, status: approval.status, updatedAt: approval.updatedAt }, data: { status: "EXECUTING", error: null } });
  if (claimed.count !== 1) throw new DeveloperFlowError("Another request is already executing this approval.");
  return true;
}

async function finishApproval(projectId: string, approvalId: string, action: "IMPLEMENT" | "MERGE") {
  await db.approvalRequest.update({ where: { id: approvalId }, data: { status: "EXECUTED", executedAt: new Date(), error: null } });
  await db.activityEvent.create({ data: { projectId, kind: "developer", message: action === "MERGE" ? "Approved pull request merged" : "Approved implementation opened a pull request" } });
}

function safeError(error: unknown) {
  return error instanceof DeveloperFlowError || error instanceof DeveloperGitHubError ? error.message : "Developer operation failed. Inspect GitHub state before retrying.";
}

export async function executeImplementation(projectId: string, approvalId: string, userId: string, client?: DeveloperGitHub) {
  await owner(projectId, userId);
  const approval = await db.approvalRequest.findFirst({ where: { id: approvalId, projectId, action: "IMPLEMENT" }, include: { execution: true } });
  if (!approval) throw new DeveloperFlowError("Implementation approval not found.");
  if (!await claimApproval(projectId, approvalId, "IMPLEMENT")) return approval.execution;
  const execution = approval.execution;
  try {
    const proposal = proposalSchema.parse(execution.proposal);
    const { linked, github } = await verifiedGitHub(projectId, userId, execution.repositoryId, client, execution.repositoryGithubId, execution.repositoryFullName);
    let head = await github.ref(linked.fullName, execution.branch);
    if (!head) {
      await github.createBranch(linked.fullName, execution.branch, shaSchema.parse(execution.baseSha));
      head = execution.baseSha;
    }
    if (head !== execution.baseSha && head !== execution.commitSha) throw new DeveloperFlowError("Feature branch changed outside Forge. Stop and review GitHub; no further writes were made.");
    await db.developerExecution.update({ where: { id: execution.id }, data: { status: "BRANCH_CREATED", startedAt: execution.startedAt ?? new Date(), error: null } });
    let commitSha = execution.commitSha;
    if (head === execution.baseSha) {
      if (!commitSha) {
        commitSha = await github.createCommit(linked.fullName, head, proposal);
        await db.developerExecution.update({ where: { id: execution.id }, data: { commitSha } });
      }
      await github.updateBranch(linked.fullName, execution.branch, commitSha);
      await db.developerExecution.update({ where: { id: execution.id }, data: { status: "COMMITTED" } });
    }
    if (!commitSha) throw new DeveloperFlowError("No committed implementation was found.");
    const existing = await github.findPull(linked.fullName, execution.branch);
    if (existing && (existing.head.sha !== commitSha || existing.base.ref !== execution.targetBranch || existing.base.repo.id !== Number(linked.githubId))) throw new DeveloperFlowError("An existing pull request does not match the approved implementation.");
    const pull = existing ?? await github.createPull(linked.fullName, execution.branch, execution.targetBranch, proposal);
    if (pull.state !== "open" || pull.head.sha !== commitSha || pull.base.repo.id !== Number(linked.githubId)) throw new DeveloperFlowError("GitHub returned a pull request that does not match the approved commit.");
    await db.$transaction(async tx => {
      await tx.developerExecution.update({ where: { id: execution.id }, data: { status: "PR_OPEN", pullNumber: pull.number, pullUrl: pull.html_url, pullState: pull.state, validationSummary: "Static proposal checks passed; remote CI must pass before merge.", error: null, completedAt: new Date() } });
      await tx.approvalRequest.upsert({ where: { executionId_action: { executionId: execution.id, action: "MERGE" } }, create: { projectId, executionId: execution.id, runId: execution.runId, action: "MERGE", requestedById: userId, description: `Merge PR #${pull.number} into ${execution.targetBranch}`, payload: { repositoryId: linked.id, branch: execution.branch, target: execution.targetBranch, pullNumber: pull.number, headSha: commitSha } }, update: {} });
    });
    await finishApproval(projectId, approvalId, "IMPLEMENT");
    return await db.developerExecution.findUniqueOrThrow({ where: { id: execution.id } });
  } catch (error) {
    const message = safeError(error);
    await db.approvalRequest.update({ where: { id: approvalId }, data: { status: "FAILED", error: message } });
    await db.developerExecution.update({ where: { id: execution.id }, data: { status: "FAILED", error: message } });
    throw new DeveloperFlowError(message);
  }
}

export async function executeMerge(projectId: string, approvalId: string, userId: string, client?: DeveloperGitHub) {
  await owner(projectId, userId);
  const approval = await db.approvalRequest.findFirst({ where: { id: approvalId, projectId, action: "MERGE" }, include: { execution: true } });
  if (!approval) throw new DeveloperFlowError("Merge approval not found.");
  if (!await claimApproval(projectId, approvalId, "MERGE")) return approval.execution;
  const execution = approval.execution;
  try {
    const { linked, github } = await verifiedGitHub(projectId, userId, execution.repositoryId, client, execution.repositoryGithubId, execution.repositoryFullName);
    const payload = approval.payload as { repositoryId?: string; branch?: string; target?: string; pullNumber?: number; headSha?: string };
    if (payload.repositoryId !== linked.id || payload.branch !== execution.branch || payload.target !== execution.targetBranch || payload.pullNumber !== execution.pullNumber || payload.headSha !== execution.commitSha) throw new DeveloperFlowError("Merge approval no longer matches the implementation.");
    if (!execution.pullNumber || !execution.commitSha) throw new DeveloperFlowError("Pull request metadata is missing.");
    const pull = await github.pull(linked.fullName, execution.pullNumber);
    if (pull.head.repo.id !== Number(linked.githubId) || pull.base.repo.id !== Number(linked.githubId) || pull.head.ref !== execution.branch || pull.base.ref !== execution.targetBranch || pull.head.sha !== execution.commitSha) throw new DeveloperFlowError("Pull request changed after approval. Request a fresh review.");
    if (pull.merged) {
      await db.developerExecution.update({ where: { id: execution.id }, data: { status: "MERGED", pullState: "merged", error: null } });
      await finishApproval(projectId, approvalId, "MERGE");
      return;
    }
    if (pull.state !== "open" || pull.mergeable !== true) throw new DeveloperFlowError("Pull request is closed, conflicting, or mergeability is still unknown.");
    const checks = await github.checks(linked.fullName, execution.commitSha);
    await db.developerExecution.update({ where: { id: execution.id }, data: { validationSummary: checks.summary } });
    if (!checks.passed) throw new DeveloperFlowError(checks.summary);
    await github.merge(linked.fullName, execution.pullNumber, execution.commitSha);
    await db.developerExecution.update({ where: { id: execution.id }, data: { status: "MERGED", pullState: "merged", error: null } });
    await finishApproval(projectId, approvalId, "MERGE");
  } catch (error) {
    const message = safeError(error);
    await db.approvalRequest.update({ where: { id: approvalId }, data: { status: "FAILED", error: message } });
    await db.developerExecution.update({ where: { id: execution.id }, data: { error: message } });
    throw new DeveloperFlowError(message);
  }
}

export async function retryApproval(projectId: string, approvalId: string, userId: string) {
  await owner(projectId, userId);
  const changed = await db.approvalRequest.updateMany({ where: { id: approvalId, projectId, decidedById: userId, OR: [{ status: "FAILED" }, { status: "EXECUTING", updatedAt: { lt: staleExecutionBefore() } }] }, data: { status: "APPROVED", error: null } });
  if (changed.count !== 1) throw new DeveloperFlowError("Only the approver can retry a failed or stale request.");
}
