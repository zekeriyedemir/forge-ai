import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { projectForOwner } from "@/lib/access";
import { ciFixSchema, generatedProposalSchema, proposalSchema, featureBranch, safeTarget, shaSchema, type DeveloperProposal } from "./contracts";
import { DeveloperGitHubError, developerGitHub, type DeveloperGitHub } from "./github";
import { generateCiFixProposal, generateDeveloperProposal } from "./proposal";
import { DeveloperProposalError, RepositoryValidationError, schemaFields, type ProposalFailureStage } from "./diagnostics";

export class DeveloperFlowError extends Error {}
const MAX_CORRECTIONS = 3;
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

function validateOperations(proposal: DeveloperProposal, context: { paths: string[]; files: { path: string; content: string }[] }) {
  const readable = new Map(context.files.map(file => [file.path, file.content]));
  const existing = new Set(context.paths);
  for (const file of proposal.files) {
    if (existing.has(file.path)) {
      if (file.operation === "CREATE") throw new DeveloperFlowError("CREATE cannot replace an existing repository file.");
      if (!readable.has(file.path) || readable.get(file.path) === file.content) throw new DeveloperFlowError("The proposal tried to replace an unread or unchanged repository file.");
    } else if (file.operation === "UPDATE") throw new DeveloperFlowError("UPDATE requires an existing inspected repository file.");
  }
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
    const parsed = generatedProposalSchema.safeParse(generated);
    if (!parsed.success) throw new DeveloperProposalError("proposal-validation", "INVALID_PROPOSAL", `The proposal failed validation (${schemaFields(parsed.error)}).`);
    const proposal = parsed.data;
    try { validateOperations(proposal, context); }
    catch { throw new DeveloperProposalError("repository-validation", "INVALID_FILE_OPERATION", "A proposed CREATE or UPDATE did not match inspected repository contents."); }
    const id = crypto.randomUUID();
    const branch = featureBranch(task.title, id);
    try {
      return await db.$transaction(async tx => {
        const execution = await tx.developerExecution.create({ data: { id, projectId, taskId, runId: task.sourceRunId, repositoryId: linked.id, repositoryGithubId: linked.githubId, repositoryFullName: linked.fullName, branch, targetBranch: target, baseSha, proposal: proposal as Prisma.InputJsonValue, inspectedPaths: context.files.map(file => file.path), validationSummary: "Static path, size, and structured-output validation passed. Repository tests and CI have not run." } });
        await tx.approvalRequest.create({ data: { projectId, executionId: id, runId: task.sourceRunId, action: "IMPLEMENT", requestedById: userId, description: `Implement ${proposal.task} in ${linked.fullName} on ${branch}`, payload: { branch, target, baseSha, files: proposal.files.map(file => ({ path: file.path, operation: file.operation, reason: file.reason })), summary: proposal.summary, risks: proposal.risks, validationPlan: proposal.validationPlan, validationExpectation: proposal.validationExpectation } } });
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
  if (approval.action === "MERGE" || approval.action === "FIX") {
    const pull = approval.execution;
    if (pull.status !== "PR_OPEN" || !pull.commitSha || !pull.pullNumber) throw new DeveloperFlowError("The implementation is not ready for merge approval.");
  }
  const changed = await db.approvalRequest.updateMany({ where: { id: approvalId, projectId, status: "PENDING" }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: userId, decidedAt: new Date() } });
  if (changed.count !== 1) throw new DeveloperFlowError("This approval was already decided.");
  await db.activityEvent.create({ data: { projectId, kind: "approval", message: `${approval.action.toLowerCase()} request ${decision === "approve" ? "approved" : "rejected"}` } });
  return approval.action;
}

async function claimApproval(projectId: string, approvalId: string, action: "IMPLEMENT" | "FIX" | "MERGE") {
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
      await tx.approvalRequest.upsert({ where: { executionId_action_round: { executionId: execution.id, action: "MERGE", round: 0 } }, create: { projectId, executionId: execution.id, runId: execution.runId, action: "MERGE", requestedById: userId, description: `Merge PR #${pull.number} into ${execution.targetBranch}`, payload: { repositoryId: linked.id, branch: execution.branch, target: execution.targetBranch, pullNumber: pull.number, headSha: commitSha } }, update: {} });
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

async function openPullForExecution(execution: { branch: string; targetBranch: string; commitSha: string | null; pullNumber: number | null }, linked: { fullName: string; githubId: bigint }, github: DeveloperGitHub) {
  if (!execution.pullNumber || !execution.commitSha) throw new DeveloperFlowError("The pull request or commit is missing.");
  const head = await github.ref(linked.fullName, execution.branch);
  const pull = await github.pull(linked.fullName, execution.pullNumber);
  if (head !== execution.commitSha || pull.state !== "open" || pull.head.sha !== execution.commitSha || pull.head.ref !== execution.branch || pull.base.ref !== execution.targetBranch || pull.head.repo.id !== Number(linked.githubId) || pull.base.repo.id !== Number(linked.githubId)) throw new DeveloperFlowError("The pull request or feature branch changed outside Forge. Refresh and review GitHub.");
  return pull;
}

export async function observeDeveloperCi(projectId: string, executionId: string, userId: string, client?: DeveloperGitHub) {
  await owner(projectId, userId);
  const execution = await db.developerExecution.findFirst({ where: { id: executionId, projectId } });
  if (!execution || execution.status !== "PR_OPEN" || !execution.commitSha) throw new DeveloperFlowError("An open Forge pull request is required to inspect CI.");
  const headSha = execution.commitSha;
  const { linked, github } = await verifiedGitHub(projectId, userId, execution.repositoryId, client, execution.repositoryGithubId, execution.repositoryFullName);
  await openPullForExecution(execution, linked, github);
  const snapshot = await github.ciSnapshot(linked.fullName, shaSchema.parse(headSha));
  const updated = await db.developerExecution.updateMany({ where: { id: execution.id, projectId, status: "PR_OPEN", commitSha: headSha }, data: { ciStatus: snapshot.state, ciSummary: snapshot.summary, ciChecks: snapshot.checks as Prisma.InputJsonValue } });
  if (updated.count !== 1) throw new DeveloperFlowError("The PR head changed during CI refresh. Refresh again for the current head.");
  return snapshot;
}

export async function createCiCorrection(projectId: string, executionId: string, userId: string, client?: DeveloperGitHub, generator = generateCiFixProposal) {
  await owner(projectId, userId);
  const execution = await db.developerExecution.findFirst({ where: { id: executionId, projectId }, include: { task: true } });
  if (!execution || execution.status !== "PR_OPEN" || !execution.commitSha) throw new DeveloperFlowError("An open Forge pull request is required for a CI correction.");
  const headSha = execution.commitSha;
  const attempts = await db.approvalRequest.count({ where: { executionId, action: "FIX" } });
  if (attempts >= MAX_CORRECTIONS || execution.correctionCount >= MAX_CORRECTIONS) throw new DeveloperFlowError("The three-correction limit was reached. Review the PR manually.");
  const active = await db.approvalRequest.findFirst({ where: { executionId, action: "FIX", status: { in: ["PENDING", "APPROVED", "EXECUTING"] } } });
  if (active) return active;
  const { linked, github } = await verifiedGitHub(projectId, userId, execution.repositoryId, client, execution.repositoryGithubId, execution.repositoryFullName);
  await openPullForExecution(execution, linked, github);
  const ci = await github.ciSnapshot(linked.fullName, headSha);
  const updated = await db.developerExecution.updateMany({ where: { id: executionId, projectId, status: "PR_OPEN", commitSha: headSha }, data: { ciStatus: ci.state, ciSummary: ci.summary, ciChecks: ci.checks as Prisma.InputJsonValue } });
  if (updated.count !== 1) throw new DeveloperFlowError("The PR head changed during CI analysis. Refresh again for the current head.");
  if (ci.state !== "FAILURE") throw new DeveloperFlowError("GitHub CI must report a failure on the current PR head before a correction can be proposed.");
  const failure = await github.ciFailure(linked.fullName, headSha);
  if (failure.job === "unavailable" && failure.diagnostics.length === 0) throw new DeveloperFlowError("Failed GitHub Actions job details are unavailable for this commit. Review the failing check on GitHub; no correction proposal was created.");
  const original = proposalSchema.safeParse(execution.proposal);
  const taskTitle = execution.task?.title ?? (original.success ? original.data.task : "Correct the Developer implementation");
  const task = `${taskTitle}\n${execution.task?.description ?? ""}`;
  const context = await github.context(linked.fullName, headSha, `${task} ${failure.summary} ${failure.diagnostics.join(" ")}`);
  const generated = await generator(task, context, { summary: failure.summary, diagnostics: failure.diagnostics });
  const parsed = ciFixSchema.safeParse(generated);
  if (!parsed.success) throw new DeveloperFlowError(`The AI correction failed structured validation (${schemaFields(parsed.error)}). No GitHub changes were made.`);
  try { validateOperations(parsed.data, context); }
  catch { throw new DeveloperFlowError("The correction targets an unread, unchanged, or incorrectly classified file. No GitHub changes were made."); }
  const round = attempts + 1;
  try {
    return await db.$transaction(async tx => {
      const current = await tx.developerExecution.findUniqueOrThrow({ where: { id: executionId } });
      if (current.commitSha !== headSha || current.status !== "PR_OPEN") throw new DeveloperFlowError("The PR head changed while preparing the correction.");
      const approval = await tx.approvalRequest.create({ data: { projectId, executionId, runId: execution.runId, action: "FIX", round, requestedById: userId, description: `Correct failed CI for PR #${execution.pullNumber}, round ${round}`, baseSha: headSha, failureSummary: failure.summary, payload: { proposal: parsed.data, inspectedPaths: context.files.map(file => file.path), job: failure.job, step: failure.step, diagnostics: failure.diagnostics } as Prisma.InputJsonValue } });
      await tx.activityEvent.create({ data: { projectId, kind: "developer", message: `CI correction round ${round} awaits approval for PR #${execution.pullNumber}` } });
      return approval;
    });
  } catch (error) {
    if (error instanceof DeveloperFlowError) throw error;
    throw new DeveloperFlowError("Could not save the CI correction approval. No GitHub changes were made.");
  }
}

export async function executeCiCorrection(projectId: string, approvalId: string, userId: string, client?: DeveloperGitHub) {
  await owner(projectId, userId);
  const approval = await db.approvalRequest.findFirst({ where: { id: approvalId, projectId, action: "FIX" }, include: { execution: true } });
  if (!approval) throw new DeveloperFlowError("CI correction approval not found.");
  if (!await claimApproval(projectId, approvalId, "FIX")) return approval.execution;
  const execution = approval.execution;
  try {
    if (execution.status !== "PR_OPEN" || !execution.commitSha || !approval.baseSha || approval.baseSha !== execution.commitSha || execution.correctionCount >= MAX_CORRECTIONS || approval.round > MAX_CORRECTIONS) throw new DeveloperFlowError("The approved correction is stale or the correction limit was reached.");
    const payload = approval.payload as { proposal?: unknown; inspectedPaths?: unknown };
    const proposal = ciFixSchema.parse(payload.proposal);
    const inspectedPaths = Array.isArray(payload.inspectedPaths) ? payload.inspectedPaths : [];
    if (proposal.files.some(file => file.operation === "UPDATE" && !inspectedPaths.includes(file.path))) throw new DeveloperFlowError("The approved correction includes a file Forge did not inspect.");
    const { linked, github } = await verifiedGitHub(projectId, userId, execution.repositoryId, client, execution.repositoryGithubId, execution.repositoryFullName);
    let head = await github.ref(linked.fullName, execution.branch);
    const pull = await github.pull(linked.fullName, execution.pullNumber!);
    if (pull.state !== "open" || pull.number !== execution.pullNumber || pull.head.ref !== execution.branch || pull.base.ref !== execution.targetBranch || pull.head.repo.id !== Number(linked.githubId) || pull.base.repo.id !== Number(linked.githubId)) throw new DeveloperFlowError("The PR changed after correction approval. No correction was pushed.");
    if (head !== approval.baseSha && head !== approval.resultSha) throw new DeveloperFlowError("The feature branch changed after correction approval. No correction was pushed.");
    if (head === approval.baseSha && pull.head.sha !== approval.baseSha) throw new DeveloperFlowError("The PR head changed after correction approval. No correction was pushed.");
    let resultSha = approval.resultSha;
    if (head === approval.baseSha) {
      if (!resultSha) {
        resultSha = await github.createCommit(linked.fullName, approval.baseSha, proposal);
        await db.approvalRequest.update({ where: { id: approvalId }, data: { resultSha } });
      }
      await github.updateBranch(linked.fullName, execution.branch, resultSha);
      head = resultSha;
    }
    if (!resultSha || head !== resultSha) throw new DeveloperFlowError("The correction commit could not be verified.");
    const updatedPull = await github.pull(linked.fullName, execution.pullNumber!);
    if (updatedPull.state !== "open" || updatedPull.head.sha !== resultSha || updatedPull.head.ref !== execution.branch || updatedPull.base.ref !== execution.targetBranch || updatedPull.head.repo.id !== Number(linked.githubId) || updatedPull.base.repo.id !== Number(linked.githubId)) throw new DeveloperFlowError("GitHub has not confirmed the corrected PR head. Retry after it updates; do not create another commit.");
    return await db.$transaction(async tx => {
      const updated = await tx.developerExecution.update({ where: { id: execution.id }, data: { commitSha: resultSha, correctionCount: approval.round, ciStatus: "PENDING", ciSummary: "Waiting for CI on the corrected PR head.", ciChecks: Prisma.JsonNull, validationSummary: "Correction committed; remote CI must pass before merge.", error: null } });
      await tx.approvalRequest.upsert({ where: { executionId_action_round: { executionId: execution.id, action: "MERGE", round: approval.round } }, create: { projectId, executionId: execution.id, runId: execution.runId, action: "MERGE", round: approval.round, requestedById: userId, description: `Merge corrected PR #${execution.pullNumber} into ${execution.targetBranch}`, payload: { repositoryId: linked.id, branch: execution.branch, target: execution.targetBranch, pullNumber: execution.pullNumber, headSha: resultSha } }, update: {} });
      await tx.approvalRequest.update({ where: { id: approvalId }, data: { status: "EXECUTED", executedAt: new Date(), error: null } });
      await tx.activityEvent.create({ data: { projectId, kind: "developer", message: "Approved CI correction updated the pull request" } });
      return updated;
    });
  } catch (error) {
    const message = safeError(error);
    await db.approvalRequest.update({ where: { id: approvalId }, data: { status: "FAILED", error: message } });
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
