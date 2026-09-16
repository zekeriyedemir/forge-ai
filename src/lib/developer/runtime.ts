import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { projectForOwner } from "@/lib/access";
import { proposalSchema, featureBranch, safeTarget, shaSchema } from "./contracts";
import { DeveloperGitHubError, developerGitHub, type DeveloperGitHub } from "./github";
import { generateDeveloperProposal } from "./proposal";
import { DeveloperProposalError, RepositoryValidationError, schemaFields, type ProposalFailureStage } from "./diagnostics";

export class DeveloperFlowError extends Error {}
const staleExecutionBefore = () => new Date(Date.now() - 15 * 60_000);

async function proposalStep<T>(stage: ProposalFailureStage, code: string, fallback: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof DeveloperProposalError) throw error;
    if (error instanceof RepositoryValidationError) throw new DeveloperProposalError("repository-validation", "REPOSITORY_LIMIT", error.message);
    if (error instanceof DeveloperGitHubError || error instanceof DeveloperFlowError) throw new DeveloperProposalError(stage, code, error.message);
    if (error instanceof ZodError) throw new DeveloperProposalError(stage, "INVALID_RESPONSE", `${fallback} (${schemaFields(error)}).`);
    throw new DeveloperProposalError(stage, code, fallback);
  }
}

async function recordProposalFailure(projectId: string, taskId: string, failure: DeveloperProposalError) {
  // Diagnostic text is constructed only from fixed messages, status codes, and schema field names.
  console.error("Forge Developer proposal failed", { projectId, taskId, stage: failure.stage, code: failure.code, reason: failure.message });
  try { await db.activityEvent.create({ data: { projectId, kind: "developer-proposal-failed", message: `Task ${taskId}: ${failure.publicMessage}` } }); }
  catch { console.error("Forge Developer proposal diagnostic persistence failed", { projectId, taskId, code: "DIAGNOSTIC_WRITE_FAILED" }); }
}

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
  try {
    const task = await proposalStep("database", "TASK_LOOKUP_FAILED", "Could not load the selected task.", () => db.task.findFirst({ where: { id: taskId, projectId } }));
    if (!task) throw new DeveloperProposalError("proposal-validation", "TASK_NOT_FOUND", "The selected task is no longer in this project.");
    const existing = await proposalStep("database", "EXECUTION_LOOKUP_FAILED", "Could not check for an existing proposal.", () => db.developerExecution.findFirst({ where: { projectId, taskId } }));
    if (existing) return existing;
    const { linked, github, remote } = await proposalStep("github-inspection", "REPOSITORY_ACCESS_FAILED", "Could not inspect the linked GitHub repository.", () => verifiedGitHub(projectId, userId, undefined, client));
    const { target, baseSha } = await proposalStep("branch-base", "BASE_RESOLUTION_FAILED", "Could not resolve the repository integration branch and base commit.", async () => {
      const target = await github.ref(linked.fullName, "dev") ? "dev" : safeTarget(remote.default_branch);
      const baseSha = await github.ref(linked.fullName, target);
      if (!baseSha) throw new DeveloperProposalError("branch-base", "BASE_NOT_FOUND", "The selected integration branch has no readable base commit.");
      return { target, baseSha };
    });
    const context = await proposalStep("github-inspection", "INSPECTION_FAILED", "Could not read the repository tree or source context.", () => github.context(linked.fullName, baseSha, `${task.title} ${task.description}`));
    const generated = await proposalStep("ai-provider", "PROVIDER_FAILED", "The AI provider could not generate a proposal.", () => generator(`${task.title}\n${task.description}`, context));
    const parsed = proposalSchema.safeParse(generated);
    if (!parsed.success) throw new DeveloperProposalError("proposal-validation", "INVALID_PROPOSAL", `The proposal failed validation (${schemaFields(parsed.error)}).`);
    const proposal = parsed.data;
    const readable = new Map(context.files.map(file => [file.path, file.content]));
    const existingPaths = new Set(context.paths);
    if (proposal.files.some(file => existingPaths.has(file.path) && (!readable.has(file.path) || readable.get(file.path) === file.content))) throw new DeveloperProposalError("repository-validation", "UNINSPECTED_OR_UNCHANGED_FILE", "The proposal tried to replace an unread or unchanged repository file.");
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await db.developerExecution.findFirst({ where: { projectId, taskId } });
        if (winner) return winner;
      }
      throw new DeveloperProposalError("database", "PERSISTENCE_FAILED", "Could not save the proposal and approval request. No GitHub changes were made.");
    }
  } catch (error) {
    const failure = error instanceof DeveloperProposalError ? error : new DeveloperProposalError("database", "UNEXPECTED_FAILURE", "Proposal processing failed before approval. No GitHub changes were made.");
    await recordProposalFailure(projectId, taskId, failure);
    throw failure;
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
