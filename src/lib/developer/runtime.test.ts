/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory Prisma mock accepts multiple generated query shapes. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperGitHub, PullInfo } from "./github";
import { DeveloperGitHubError } from "./github";
import { DeveloperProposalError, RepositoryValidationError } from "./diagnostics";

const state = vi.hoisted(() => ({ owner: true, failTransaction: false, approvals: [] as Record<string, any>[], executions: [] as Record<string, any>[], task: { id: "task-id", projectId: "project-id", title: "Add task view", description: "Display tasks", sourceRunId: null }, linked: { id: "link-id", projectId: "project-id", githubId: BigInt(7), fullName: "owner/repo" }, events: [] as Record<string, unknown>[] }));

vi.mock("@/lib/access", () => ({ projectForOwner: vi.fn(async () => state.owner ? { id: "project-id" } : null) }));
vi.mock("@/lib/github", () => ({ githubToken: vi.fn() }));
vi.mock("./proposal", () => ({ generateDeveloperProposal: vi.fn(), generateCiFixProposal: vi.fn() }));
vi.mock("@/lib/db", () => {
  const client = {
    task: { findFirst: vi.fn(async ({ where }: any) => where.id === state.task.id && where.projectId === state.task.projectId ? state.task : null) },
    gitHubRepository: { findUnique: vi.fn(async () => state.linked) },
    developerExecution: {
      findFirst: vi.fn(async ({ where }: any) => state.executions.find(item => item.projectId === where.projectId && (where.id ? item.id === where.id : item.taskId === where.taskId)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => state.executions.find(item => item.id === where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => state.executions.find(item => item.id === where.id)),
      create: vi.fn(async ({ data }: any) => { const row = { ...data, status: "PROPOSED", startedAt: null, commitSha: null, pullNumber: null, correctionCount: 0, externalHeadSha: null, headSource: "FORGE", updatedAt: new Date() }; state.executions.push(row); return row; }),
      update: vi.fn(async ({ where, data }: any) => { const row = state.executions.find(item => item.id === where.id)!; Object.assign(row, data); return row; }),
      updateMany: vi.fn(async ({ where, data }: any) => { const row = state.executions.find(item => item.id === where.id && item.projectId === where.projectId && item.status === where.status && item.commitSha === where.commitSha && (where.externalHeadSha === undefined || item.externalHeadSha === where.externalHeadSha)); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    },
    approvalRequest: {
      create: vi.fn(async ({ data }: any) => { const row = { ...data, id: crypto.randomUUID(), status: "PENDING", updatedAt: new Date(), decidedById: null }; state.approvals.push(row); return row; }),
      findFirst: vi.fn(async ({ where }: any) => { const row = state.approvals.find(item => (where.id ? item.id === where.id : item.executionId === where.executionId) && (!where.projectId || item.projectId === where.projectId) && (!where.action || item.action === where.action) && (!where.status || where.status.in.includes(item.status))); return row ? { ...row, execution: state.executions.find(item => item.id === row.executionId) } : null; }),
      count: vi.fn(async ({ where }: any) => state.approvals.filter(item => item.executionId === where.executionId && item.action === where.action).length),
      updateMany: vi.fn(async ({ where, data }: any) => { const rows = state.approvals.filter(item => (!where.id || item.id === where.id) && (!where.projectId || item.projectId === where.projectId) && (!where.executionId || item.executionId === where.executionId) && (!where.action || (typeof where.action === "string" ? item.action === where.action : where.action.in.includes(item.action))) && (!where.status || (typeof where.status === "string" ? item.status === where.status : where.status.in.includes(item.status))) && (!where.OR || where.OR.some((clause: any) => item.status === clause.status && (!clause.updatedAt || item.updatedAt < clause.updatedAt.lt))) && (!where.updatedAt || item.updatedAt === where.updatedAt) && (!where.decidedById || item.decidedById === where.decidedById)); for (const row of rows) Object.assign(row, data, { updatedAt: new Date() }); return { count: rows.length }; }),
      update: vi.fn(async ({ where, data }: any) => { const row = state.approvals.find(item => item.id === where.id)!; Object.assign(row, data, { updatedAt: new Date() }); return row; }),
      upsert: vi.fn(async ({ where, create }: any) => { const key = where.executionId_action_round; const row = state.approvals.find(item => item.executionId === key.executionId && item.action === key.action && (item.round ?? 0) === key.round); if (row) return row; const fresh = { ...create, id: crypto.randomUUID(), status: "PENDING", updatedAt: new Date(), decidedById: null }; state.approvals.push(fresh); return fresh; }),
    },
    activityEvent: { create: vi.fn(async ({ data }: any) => { state.events.push(data); }) },
  };
  return { db: { ...client, $transaction: async (work: (tx: typeof client) => Promise<unknown>) => { if (state.failTransaction) throw new Error("private database URL leaked in raw error"); return work(client); } } };
});

import { createCiCorrection, createDeveloperProposal, decideApproval, executeCiCorrection, executeExternalHeadAdoption, executeImplementation, executeMerge, observeDeveloperCi, reviewExternalHead, retryApproval } from "./runtime";

const baseSha = "a".repeat(40);
const commitSha = "b".repeat(40);
const proposal = { task: "Add task view", summary: "Create a task view with a simple existing task list.", files: [{ path: "src/app/tasks/page.tsx", operation: "CREATE" as const, content: "export default function Tasks() { return <main>Tasks</main>; }", reason: "Add the task view page" }], validationPlan: "Run CI and review the complete change in the PR.", validationExpectation: "The task view renders and all configured checks pass.", risks: "The task API may require additional access control.", commitMessage: "feat: add task view page" };

function fakeGitHub() {
  let branch: string | null = null;
  let pull: PullInfo | null = null;
  const github: DeveloperGitHub = {
    repository: vi.fn(async () => ({ id: 7, full_name: "owner/repo", default_branch: "main", permissions: { push: true } })),
    ref: vi.fn(async (_, name) => name === "dev" ? baseSha : branch),
    context: vi.fn(async () => ({ paths: [], files: [] })),
    createBranch: vi.fn(async (_, name, sha) => { expect(name).toMatch(/^forge\//); branch = sha; }),
    createCommit: vi.fn(async (_, parent) => parent === baseSha ? commitSha : "c".repeat(40)),
    updateBranch: vi.fn(async (_, __, sha) => { branch = sha; if (pull) pull = { ...pull, head: { ...pull.head, sha } }; }),
    findPull: vi.fn(async () => pull),
    createPull: vi.fn(async (_, name, target) => { pull = { number: 14, html_url: "https://github.com/owner/repo/pull/14", state: "open", mergeable: true, merged: false, head: { sha: commitSha, ref: name, repo: { id: 7 } }, base: { ref: target, repo: { id: 7 } } }; return pull; }),
    pull: vi.fn(async () => pull!),
    checks: vi.fn(async () => ({ passed: true, summary: "1 check passed" })),
    ciSnapshot: vi.fn(async () => ({ state: "SUCCESS" as const, summary: "1 check passed", checks: [{ name: "build", status: "completed", conclusion: "success" }] })),
    ciFailure: vi.fn(async () => ({ summary: "Build failed in typecheck.", job: "build", step: "typecheck", diagnostics: ["TypeScript TS2322"] })),
    merge: vi.fn(async () => { pull = { ...pull!, merged: true, state: "closed" }; }),
  };
  return { github, changePull: (next: Partial<PullInfo>) => { pull = { ...pull!, ...next }; }, changeBranch: (sha: string) => { branch = sha; }, externalHead: (sha: string) => { branch = sha; pull = { ...pull!, head: { ...pull!.head, sha } }; } };
}

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); state.owner = true; state.failTransaction = false; state.approvals.length = 0; state.executions.length = 0; state.events.length = 0; });

describe("approved Developer execution", () => {
  it("accepts a multi-file proposal updating inspected source and adding a test", async () => {
    const { github } = fakeGitHub();
    vi.mocked(github.context).mockResolvedValueOnce({ paths: ["src/lib/tasks.ts"], files: [{ path: "src/lib/tasks.ts", content: "export const tasks = [];" }] });
    const multi = { ...proposal, files: [
      { path: "src/lib/tasks.ts", operation: "UPDATE" as const, content: "export const tasks = ['ready'];", reason: "Add the task data" },
      { path: "tests/tasks.test.ts", operation: "CREATE" as const, content: "import { expect, test } from 'vitest'; test('tasks', () => expect(true).toBe(true));", reason: "Cover the task data" },
    ] };
    const execution = await createDeveloperProposal("project-id", "task-id", "user-id", github, async () => multi);
    expect(execution.inspectedPaths).toEqual(["src/lib/tasks.ts"]);
    expect(state.approvals[0].payload.files.map((file: any) => file.operation)).toEqual(["UPDATE", "CREATE"]);
  });

  it("runs proposal → approval → real branch/commit/PR → separate merge approval with fake GitHub", async () => {
    const { github } = fakeGitHub();
    const execution = await createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal);
    const implement = state.approvals[0];
    expect(execution.branch).toMatch(/^forge\/add-task-view-/);
    await expect(executeImplementation("project-id", implement.id, "user-id", github)).rejects.toThrow("Explicit approval");
    expect(github.createBranch).not.toHaveBeenCalled();
    await decideApproval("project-id", implement.id, "user-id", "approve");
    await executeImplementation("project-id", implement.id, "user-id", github);
    expect(github.createBranch).toHaveBeenCalledOnce();
    expect(github.createCommit).toHaveBeenCalledOnce();
    expect(github.updateBranch).toHaveBeenCalledOnce();
    expect(github.createPull).toHaveBeenCalledOnce();
    expect(state.executions[0].status).toBe("PR_OPEN");
    const merge = state.approvals.find(item => item.action === "MERGE")!;
    await expect(executeMerge("project-id", merge.id, "user-id", github)).rejects.toThrow("Explicit approval");
    await decideApproval("project-id", merge.id, "user-id", "approve");
    await executeMerge("project-id", merge.id, "user-id", github);
    expect(github.merge).toHaveBeenCalledWith("owner/repo", 14, commitSha);
    expect(state.executions[0].status).toBe("MERGED");
    await executeImplementation("project-id", implement.id, "user-id", github);
    expect(github.createCommit).toHaveBeenCalledOnce();
  });

  it("rejects non-owners before approval or execution", async () => {
    const { github } = fakeGitHub();
    await createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal);
    state.owner = false;
    await expect(decideApproval("project-id", state.approvals[0].id, "attacker", "approve")).rejects.toThrow("access denied");
    await expect(executeImplementation("project-id", state.approvals[0].id, "attacker", github)).rejects.toThrow("access denied");
    expect(github.createBranch).not.toHaveBeenCalled();
  });

  it("does not write after a rejected implementation request", async () => {
    const { github } = fakeGitHub();
    await createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal);
    const approval = state.approvals[0];
    await decideApproval("project-id", approval.id, "user-id", "reject");
    await expect(executeImplementation("project-id", approval.id, "user-id", github)).rejects.toThrow("Explicit approval");
    expect(github.createBranch).not.toHaveBeenCalled();
  });

  it("allows the approver to resume a stale in-progress claim", async () => {
    const { github } = fakeGitHub();
    await createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal);
    const approval = state.approvals[0];
    await decideApproval("project-id", approval.id, "user-id", "approve");
    approval.status = "EXECUTING";
    approval.updatedAt = new Date(Date.now() - 16 * 60_000);
    await retryApproval("project-id", approval.id, "user-id");
    expect(approval.status).toBe("APPROVED");
  });

  it("rejects changed repository binding and stale merge SHA", async () => {
    const { github, changePull } = fakeGitHub();
    await createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal);
    const implement = state.approvals[0];
    await decideApproval("project-id", implement.id, "user-id", "approve");
    state.linked.fullName = "owner/other";
    await expect(executeImplementation("project-id", implement.id, "user-id", github)).rejects.toThrow("linked GitHub repository changed");
    state.linked.fullName = "owner/repo";
    await retryApproval("project-id", implement.id, "user-id");
    await executeImplementation("project-id", implement.id, "user-id", github);
    const merge = state.approvals.find(item => item.action === "MERGE")!;
    await decideApproval("project-id", merge.id, "user-id", "approve");
    changePull({ head: { sha: "c".repeat(40), ref: state.executions[0].branch, repo: { id: 7 } } });
    await expect(executeMerge("project-id", merge.id, "user-id", github)).rejects.toThrow("changed after approval");
    expect(github.merge).not.toHaveBeenCalled();
  });

  it("persists a GitHub failure without creating a duplicate branch on explicit retry", async () => {
    const { github } = fakeGitHub();
    await createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal);
    const implement = state.approvals[0];
    await decideApproval("project-id", implement.id, "user-id", "approve");
    vi.mocked(github.updateBranch).mockRejectedValueOnce(new Error("network failed"));
    await expect(executeImplementation("project-id", implement.id, "user-id", github)).rejects.toThrow("Developer operation failed");
    expect(state.executions[0].status).toBe("FAILED");
    expect(implement.status).toBe("FAILED");
    await retryApproval("project-id", implement.id, "user-id");
    await executeImplementation("project-id", implement.id, "user-id", github);
    expect(github.createBranch).toHaveBeenCalledOnce();
    expect(github.createCommit).toHaveBeenCalledOnce();
    expect(github.createPull).toHaveBeenCalledOnce();
  });

  it("blocks merge without passing checks, then retries without a second merge approval", async () => {
    const { github } = fakeGitHub();
    await createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal);
    const implement = state.approvals[0];
    await decideApproval("project-id", implement.id, "user-id", "approve");
    await executeImplementation("project-id", implement.id, "user-id", github);
    const merge = state.approvals.find(item => item.action === "MERGE")!;
    await decideApproval("project-id", merge.id, "user-id", "approve");
    vi.mocked(github.checks).mockResolvedValueOnce({ passed: false, summary: "GitHub checks are pending" });
    await expect(executeMerge("project-id", merge.id, "user-id", github)).rejects.toThrow("checks are pending");
    expect(github.merge).not.toHaveBeenCalled();
    expect(merge.status).toBe("FAILED");
    await retryApproval("project-id", merge.id, "user-id");
    await executeMerge("project-id", merge.id, "user-id", github);
    expect(github.merge).toHaveBeenCalledOnce();
    expect(state.approvals.filter(item => item.action === "MERGE")).toHaveLength(1);
  });

  it("rejects malformed proposals and writes nothing", async () => {
    const { github } = fakeGitHub();
    await expect(createDeveloperProposal("project-id", "task-id", "user-id", github, async () => ({ ...proposal, files: [{ ...proposal.files[0], path: "../.env" }] }))).rejects.toThrow();
    expect(state.approvals).toHaveLength(0);
    expect(github.createBranch).not.toHaveBeenCalled();
  });

  it("persists a malformed provider-envelope failure without any GitHub write or approval", async () => {
    const { github } = fakeGitHub();
    const failure = new DeveloperProposalError("ai-provider", "INVALID_COMPLETION_ENVELOPE", 'The provider returned an unusable envelope. Response structure: {"httpStatus":200,"choices":0,"content":"missing"}. No GitHub changes were made.');
    await expect(createDeveloperProposal("project-id", "task-id", "user-id", github, async () => { throw failure; })).rejects.toBe(failure);
    expect(state.events.at(-1)).toMatchObject({ kind: "developer-proposal-failed", message: expect.stringContaining("INVALID_COMPLETION_ENVELOPE") });
    expect(state.approvals).toHaveLength(0);
    expect(state.executions).toHaveLength(0);
    for (const operation of [github.createBranch, github.createCommit, github.updateBranch, github.createPull, github.merge]) expect(operation).not.toHaveBeenCalled();
  });

  it.each([
    ["github-inspection", "REPOSITORY_ACCESS_FAILED", (github: DeveloperGitHub) => vi.mocked(github.repository).mockRejectedValueOnce(new DeveloperGitHubError("GitHub denied this operation."))],
    ["branch-base", "BASE_RESOLUTION_FAILED", (github: DeveloperGitHub) => vi.mocked(github.ref).mockRejectedValueOnce(new DeveloperGitHubError("GitHub branch request failed."))],
    ["repository-validation", "REPOSITORY_LIMIT", (github: DeveloperGitHub) => vi.mocked(github.context).mockRejectedValueOnce(new RepositoryValidationError("Repository tree has more than 500 entries; Forge cannot inspect it safely."))],
    ["github-inspection", "INSPECTION_FAILED", (github: DeveloperGitHub) => vi.mocked(github.context).mockRejectedValueOnce(new DeveloperGitHubError("GitHub repository inspection failed."))],
  ] as const)("persists sanitized %s diagnostics for %s", async (stage, code, fail) => {
    const { github } = fakeGitHub();
    fail(github);
    await expect(createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal)).rejects.toMatchObject({ stage, code });
    expect(state.events).toContainEqual(expect.objectContaining({ kind: "developer-proposal-failed", message: expect.stringContaining(code) }));
    expect(console.error).toHaveBeenCalledWith("Forge Developer proposal failed", expect.objectContaining({ stage, code }));
    expect(state.approvals).toHaveLength(0);
  });

  it("distinguishes provider, structured-output, and final proposal validation failures", async () => {
    const cases = [
      { failure: new DeveloperProposalError("ai-provider", "RATE_LIMITED", "The AI provider rate limit was reached."), stage: "ai-provider", code: "RATE_LIMITED" },
      { failure: new DeveloperProposalError("structured-output", "MALFORMED_JSON", "The AI returned invalid JSON after one retry."), stage: "structured-output", code: "MALFORMED_JSON" },
    ];
    for (const item of cases) {
      const { github } = fakeGitHub();
      await expect(createDeveloperProposal("project-id", "task-id", "user-id", github, async () => { throw item.failure; })).rejects.toMatchObject({ stage: item.stage, code: item.code });
      expect(state.events.at(-1)).toMatchObject({ kind: "developer-proposal-failed", message: expect.stringContaining(item.code) });
    }
    const { github } = fakeGitHub();
    await expect(createDeveloperProposal("project-id", "task-id", "user-id", github, async () => ({ ...proposal, files: [{ ...proposal.files[0], path: "../.env" }] }))).rejects.toMatchObject({ stage: "proposal-validation", code: "INVALID_PROPOSAL" });
    expect(state.events.at(-1)?.message).toContain("files.0.path");
  });

  it("reports unread existing files as repository path validation failures", async () => {
    const { github } = fakeGitHub();
    vi.mocked(github.context).mockResolvedValueOnce({ paths: [proposal.files[0].path], files: [] });
    await expect(createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal)).rejects.toMatchObject({ stage: "repository-validation", code: "INVALID_FILE_OPERATION" });
    expect(state.events.at(-1)?.message).toContain("repository validation");
  });

  it("reports database persistence failures without leaking raw database errors", async () => {
    const { github } = fakeGitHub();
    state.failTransaction = true;
    await expect(createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal)).rejects.toMatchObject({ stage: "database", code: "PERSISTENCE_FAILED" });
    expect(state.events.at(-1)?.message).not.toContain("private database URL");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private database URL");
    expect(state.approvals).toHaveLength(0);
  });
});

describe("approved CI correction loop", () => {
  const fix = { ...proposal, summary: "Correct the task view and add a regression test for its behavior.", files: [
    { path: proposal.files[0].path, operation: "UPDATE" as const, content: "export default function Tasks() { return <main>Updated tasks</main>; }", reason: "Correct the task view rendering" },
    { path: "tests/tasks.test.ts", operation: "CREATE" as const, content: "import { expect, test } from 'vitest'; test('task', () => expect(true).toBe(true));", reason: "Cover the task view behavior" },
  ], validationExpectation: "The typecheck and regression test pass in GitHub CI.", failureSummary: "The build failed during the TypeScript check.", likelyCause: "The task view used an invalid return type in the previous commit.", commitMessage: "fix: correct task view and add regression test" };

  async function openPr() {
    const client = fakeGitHub();
    const execution = await createDeveloperProposal("project-id", "task-id", "user-id", client.github, async () => proposal);
    const implement = state.approvals.find(item => item.action === "IMPLEMENT")!;
    await decideApproval("project-id", implement.id, "user-id", "approve");
    await executeImplementation("project-id", implement.id, "user-id", client.github);
    vi.mocked(client.github.ciSnapshot).mockResolvedValue({ state: "FAILURE", summary: "1 GitHub check failed.", checks: [{ name: "build", status: "completed", conclusion: "failure" }] });
    vi.mocked(client.github.context).mockResolvedValue({ paths: [proposal.files[0].path], files: [{ path: proposal.files[0].path, content: proposal.files[0].content }] });
    return { ...client, execution };
  }

  it("persists CI state and creates a complete fix approval without writing to GitHub", async () => {
    const { github, execution } = await openPr();
    expect((await observeDeveloperCi("project-id", execution.id, "user-id", github)).state).toBe("FAILURE");
    const writesBefore = vi.mocked(github.createCommit).mock.calls.length;
    const approval = await createCiCorrection("project-id", execution.id, "user-id", github, async () => fix);
    expect(approval.action).toBe("FIX");
    expect(approval.round).toBe(1);
    expect(approval.baseSha).toBe(commitSha);
    expect(vi.mocked(github.createCommit).mock.calls.length).toBe(writesBefore);
    await expect(executeCiCorrection("project-id", approval.id, "user-id", github)).rejects.toThrow("Explicit approval");
  });

  it("updates the same branch and PR only after approval, then requires a fresh merge approval", async () => {
    const { github, execution } = await openPr();
    const approval = await createCiCorrection("project-id", execution.id, "user-id", github, async () => fix);
    await decideApproval("project-id", approval.id, "user-id", "approve");
    await executeCiCorrection("project-id", approval.id, "user-id", github);
    expect(github.createPull).toHaveBeenCalledTimes(1);
    expect(github.createBranch).toHaveBeenCalledTimes(1);
    expect(github.updateBranch).toHaveBeenLastCalledWith("owner/repo", execution.branch, "c".repeat(40));
    expect(state.executions[0].commitSha).toBe("c".repeat(40));
    expect(state.executions[0].correctionCount).toBe(1);
    expect(state.executions[0].ciStatus).toBe("PENDING");
    expect(state.approvals.filter(item => item.action === "MERGE")).toHaveLength(2);
    const oldMerge = state.approvals.find(item => item.action === "MERGE" && (item.round ?? 0) === 0)!;
    expect(oldMerge.status).toBe("REJECTED");
    await expect(decideApproval("project-id", oldMerge.id, "user-id", "approve")).rejects.toThrow("already been decided");
    await expect(executeMerge("project-id", oldMerge.id, "user-id", github)).rejects.toThrow("Explicit approval");
    expect(github.merge).not.toHaveBeenCalled();
  });

  it("rejects a stale branch or PR head before creating a correction commit", async () => {
    const { github, execution, changeBranch } = await openPr();
    const approval = await createCiCorrection("project-id", execution.id, "user-id", github, async () => fix);
    await decideApproval("project-id", approval.id, "user-id", "approve");
    changeBranch("d".repeat(40));
    await expect(executeCiCorrection("project-id", approval.id, "user-id", github)).rejects.toThrow("feature branch changed");
    expect(github.createCommit).toHaveBeenCalledTimes(1);
    expect(github.updateBranch).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed PR head even when the branch reference still matches", async () => {
    const { github, execution, changePull } = await openPr();
    const approval = await createCiCorrection("project-id", execution.id, "user-id", github, async () => fix);
    await decideApproval("project-id", approval.id, "user-id", "approve");
    changePull({ head: { sha: "d".repeat(40), ref: execution.branch, repo: { id: 7 } } });
    await expect(executeCiCorrection("project-id", approval.id, "user-id", github)).rejects.toThrow("PR head changed");
    expect(github.createCommit).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed fix output and unread UPDATE paths without GitHub writes", async () => {
    const { github, execution } = await openPr();
    await expect(createCiCorrection("project-id", execution.id, "user-id", github, async () => ({ ...fix, files: [{ ...fix.files[0], path: "../.env" }] }))).rejects.toThrow("structured validation");
    await expect(createCiCorrection("project-id", execution.id, "user-id", github, async () => ({ ...fix, files: [{ ...fix.files[0], path: "src/lib/unread.ts" }] }))).rejects.toThrow("incorrectly classified");
    expect(state.approvals.filter(item => item.action === "FIX")).toHaveLength(0);
    expect(github.createCommit).toHaveBeenCalledTimes(1);
  });

  it("bounds corrections to three rounds and reports GitHub API failures", async () => {
    const { github, execution } = await openPr();
    state.executions[0].correctionCount = 3;
    await expect(createCiCorrection("project-id", execution.id, "user-id", github, async () => fix)).rejects.toThrow("three-correction limit");
    state.executions[0].correctionCount = 0;
    vi.mocked(github.ciSnapshot).mockRejectedValueOnce(new DeveloperGitHubError("GitHub denied this operation."));
    await expect(observeDeveloperCi("project-id", execution.id, "user-id", github)).rejects.toThrow("GitHub denied");
  });

  it("does not overwrite CI state when the stored PR head changes during refresh", async () => {
    const { github, execution } = await openPr();
    vi.mocked(github.ciSnapshot).mockImplementationOnce(async () => { state.executions[0].commitSha = "c".repeat(40); return { state: "FAILURE", summary: "old failure", checks: [] }; });
    await expect(observeDeveloperCi("project-id", execution.id, "user-id", github)).rejects.toThrow("head changed during CI refresh");
    expect(state.executions[0].ciSummary).toBeUndefined();
  });
});

describe("explicit external head adoption", () => {
  const externalSha = "d".repeat(40);

  async function openPr() {
    const client = fakeGitHub();
    const execution = await createDeveloperProposal("project-id", "task-id", "user-id", client.github, async () => proposal);
    const implement = state.approvals.find(item => item.action === "IMPLEMENT")!;
    await decideApproval("project-id", implement.id, "user-id", "approve");
    await executeImplementation("project-id", implement.id, "user-id", client.github);
    return { ...client, execution };
  }

  it("detects an external head, blocks old merge, and requires explicit approval before read-only adoption", async () => {
    const { github, execution, externalHead } = await openPr();
    const oldMerge = state.approvals.find(item => item.action === "MERGE")!;
    await decideApproval("project-id", oldMerge.id, "user-id", "approve");
    state.executions[0].ciStatus = "SUCCESS";
    externalHead(externalSha);
    const writes = { commits: vi.mocked(github.createCommit).mock.calls.length, branches: vi.mocked(github.updateBranch).mock.calls.length };
    expect((await observeDeveloperCi("project-id", execution.id, "user-id", github)).state).toBe("UNAVAILABLE");
    expect(state.executions[0]).toMatchObject({ status: "EXTERNAL_CHANGE", commitSha, externalHeadSha: externalSha, ciStatus: "UNAVAILABLE", headSource: "FORGE" });
    await expect(executeMerge("project-id", oldMerge.id, "user-id", github)).rejects.toThrow("unreviewed external change");
    await expect(createCiCorrection("project-id", execution.id, "user-id", github)).rejects.toThrow("open Forge pull request");
    const adopt = await reviewExternalHead("project-id", execution.id, "user-id", github);
    expect(adopt).toMatchObject({ action: "ADOPT", status: "PENDING", baseSha: commitSha, resultSha: externalSha });
    await expect(executeExternalHeadAdoption("project-id", adopt.id, "user-id", github)).rejects.toThrow("Explicit approval");
    expect(state.executions[0].commitSha).toBe(commitSha);
    expect(vi.mocked(github.createCommit).mock.calls.length).toBe(writes.commits);
    expect(vi.mocked(github.updateBranch).mock.calls.length).toBe(writes.branches);
    await decideApproval("project-id", adopt.id, "user-id", "approve");
    await executeExternalHeadAdoption("project-id", adopt.id, "user-id", github);
    expect(github.ciSnapshot).toHaveBeenCalledWith("owner/repo", externalSha);
    expect(state.executions[0]).toMatchObject({ status: "PR_OPEN", commitSha: externalSha, externalHeadSha: null, headSource: "EXTERNAL", ciStatus: "SUCCESS" });
    expect(oldMerge.status).toBe("REJECTED");
    const freshMerge = state.approvals.find(item => item.action === "MERGE" && item.payload.headSha === externalSha)!;
    expect(freshMerge.status).toBe("PENDING");
    expect(github.createPull).toHaveBeenCalledTimes(1);
    expect(vi.mocked(github.createCommit).mock.calls.length).toBe(writes.commits);
    expect(vi.mocked(github.updateBranch).mock.calls.length).toBe(writes.branches);
    expect(state.events.some(event => String(event.message).includes("Forge did not create this commit"))).toBe(true);
  });

  it("detects a branch move that occurs during the CI fetch", async () => {
    const { github, execution, externalHead } = await openPr();
    vi.mocked(github.ciSnapshot).mockImplementationOnce(async () => { externalHead(externalSha); return { state: "SUCCESS", summary: "old check passed", checks: [] }; });
    expect((await observeDeveloperCi("project-id", execution.id, "user-id", github)).state).toBe("UNAVAILABLE");
    expect(state.executions[0]).toMatchObject({ status: "EXTERNAL_CHANGE", externalHeadSha: externalSha, ciStatus: "UNAVAILABLE" });
  });

  it("rejects a stale adoption if GitHub changes the SHA again and requires another refresh", async () => {
    const { github, execution, externalHead } = await openPr();
    externalHead(externalSha);
    await observeDeveloperCi("project-id", execution.id, "user-id", github);
    const adopt = await reviewExternalHead("project-id", execution.id, "user-id", github);
    await decideApproval("project-id", adopt.id, "user-id", "approve");
    const newerSha = "e".repeat(40);
    externalHead(newerSha);
    await expect(executeExternalHeadAdoption("project-id", adopt.id, "user-id", github)).rejects.toThrow("changed after review");
    expect(adopt.status).toBe("REJECTED");
    expect(state.executions[0].commitSha).toBe(commitSha);
    await observeDeveloperCi("project-id", execution.id, "user-id", github);
    expect(state.executions[0].externalHeadSha).toBe(newerSha);
    const next = await reviewExternalHead("project-id", execution.id, "user-id", github);
    expect(next.id).not.toBe(adopt.id);
    expect(next.resultSha).toBe(newerSha);
    expect(github.createCommit).toHaveBeenCalledTimes(1);
  });

  it("refresh rejects a pending adoption review when a second external SHA appears", async () => {
    const { github, execution, externalHead } = await openPr();
    externalHead(externalSha);
    await observeDeveloperCi("project-id", execution.id, "user-id", github);
    const first = await reviewExternalHead("project-id", execution.id, "user-id", github);
    externalHead("e".repeat(40));
    await observeDeveloperCi("project-id", execution.id, "user-id", github);
    expect(first.status).toBe("REJECTED");
    await expect(decideApproval("project-id", first.id, "user-id", "approve")).rejects.toThrow("already been decided");
    const second = await reviewExternalHead("project-id", execution.id, "user-id", github);
    expect(second.resultSha).toBe("e".repeat(40));
    expect(github.createCommit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["repository", (github: DeveloperGitHub, changePull: (next: Partial<PullInfo>) => void, execution: Record<string, any>) => { vi.mocked(github.repository).mockResolvedValue({ id: 99, full_name: "owner/repo", default_branch: "main", permissions: { push: true } }); void changePull; void execution; }],
    ["PR number", (_: DeveloperGitHub, changePull: (next: Partial<PullInfo>) => void) => changePull({ number: 99 })],
    ["closed PR", (_: DeveloperGitHub, changePull: (next: Partial<PullInfo>) => void) => changePull({ state: "closed" })],
    ["base branch", (_: DeveloperGitHub, changePull: (next: Partial<PullInfo>) => void) => changePull({ base: { ref: "main", repo: { id: 7 } } })],
    ["head branch", (_: DeveloperGitHub, changePull: (next: Partial<PullInfo>) => void) => changePull({ head: { sha: externalSha, ref: "wrong-branch", repo: { id: 7 } } })],
    ["head repository", (_: DeveloperGitHub, changePull: (next: Partial<PullInfo>) => void, execution: Record<string, any>) => changePull({ head: { sha: externalSha, ref: execution.branch, repo: { id: 99 } } })],
    ["base repository", (_: DeveloperGitHub, changePull: (next: Partial<PullInfo>) => void) => changePull({ base: { ref: "dev", repo: { id: 99 } } })],
  ] as const)("rejects %s mismatch before adopting", async (_name, mutate) => {
    const { github, execution, externalHead, changePull } = await openPr();
    externalHead(externalSha);
    await observeDeveloperCi("project-id", execution.id, "user-id", github);
    const adopt = await reviewExternalHead("project-id", execution.id, "user-id", github);
    await decideApproval("project-id", adopt.id, "user-id", "approve");
    mutate(github, changePull, execution);
    await expect(executeExternalHeadAdoption("project-id", adopt.id, "user-id", github)).rejects.toThrow();
    expect(adopt.status).toBe("REJECTED");
    expect(state.executions[0].commitSha).toBe(commitSha);
    expect(github.createCommit).toHaveBeenCalledTimes(1);
    expect(github.updateBranch).toHaveBeenCalledTimes(1);
  });

  it("uses a failed adopted SHA for a separately approved correction on the same PR", async () => {
    const { github, execution, externalHead } = await openPr();
    externalHead(externalSha);
    await observeDeveloperCi("project-id", execution.id, "user-id", github);
    const adopt = await reviewExternalHead("project-id", execution.id, "user-id", github);
    vi.mocked(github.ciSnapshot).mockResolvedValue({ state: "FAILURE", summary: "1 check failed", checks: [{ name: "test", status: "completed", conclusion: "failure" }] });
    await decideApproval("project-id", adopt.id, "user-id", "approve");
    await executeExternalHeadAdoption("project-id", adopt.id, "user-id", github);
    expect(state.executions[0].ciStatus).toBe("FAILURE");
    const fix = { ...proposal, summary: "Add a focused regression test for the adopted task view.", files: [{ path: "tests/adopted-task.test.ts", operation: "CREATE" as const, content: "import { expect, test } from 'vitest'; test('task', () => expect(true).toBe(true));", reason: "Cover the adopted task view" }], failureSummary: "The test check failed on the adopted commit.", likelyCause: "The adopted change introduced a failing assertion.", commitMessage: "fix: add regression test for adopted task view" };
    const correction = await createCiCorrection("project-id", execution.id, "user-id", github, async () => fix);
    expect(correction.baseSha).toBe(externalSha);
    expect(github.createCommit).toHaveBeenCalledTimes(1);
    await expect(executeCiCorrection("project-id", correction.id, "user-id", github)).rejects.toThrow("Explicit approval");
    await decideApproval("project-id", correction.id, "user-id", "approve");
    await executeCiCorrection("project-id", correction.id, "user-id", github);
    expect(github.createPull).toHaveBeenCalledTimes(1);
    expect(github.updateBranch).toHaveBeenLastCalledWith("owner/repo", execution.branch, "c".repeat(40));
    expect(state.executions[0]).toMatchObject({ commitSha: "c".repeat(40), headSource: "FORGE", correctionCount: 1 });
    expect(state.approvals.filter(item => item.action === "MERGE")).toHaveLength(3);
  });

  it("enforces project ownership before preparing or approving adoption", async () => {
    const { github, execution, externalHead } = await openPr();
    externalHead(externalSha);
    await observeDeveloperCi("project-id", execution.id, "user-id", github);
    state.owner = false;
    await expect(reviewExternalHead("project-id", execution.id, "attacker", github)).rejects.toThrow("access denied");
    expect(state.approvals.filter(item => item.action === "ADOPT")).toHaveLength(0);
  });

  it("blocks a non-owner from approving an adoption request", async () => {
    const { github, execution, externalHead } = await openPr();
    externalHead(externalSha);
    await observeDeveloperCi("project-id", execution.id, "user-id", github);
    const adoption = await reviewExternalHead("project-id", execution.id, "user-id", github);
    state.owner = false;
    await expect(decideApproval("project-id", adoption.id, "attacker", "approve")).rejects.toThrow("access denied");
    await expect(executeExternalHeadAdoption("project-id", adoption.id, "attacker", github)).rejects.toThrow("access denied");
    expect(adoption.status).toBe("PENDING");
    expect(state.executions[0].commitSha).toBe(commitSha);
  });
});
