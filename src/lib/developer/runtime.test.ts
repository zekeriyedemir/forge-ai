/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory Prisma mock accepts multiple generated query shapes. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperGitHub, PullInfo } from "./github";
import { DeveloperGitHubError } from "./github";
import { DeveloperProposalError, RepositoryValidationError } from "./diagnostics";

const state = vi.hoisted(() => ({ owner: true, failTransaction: false, approvals: [] as Record<string, any>[], executions: [] as Record<string, any>[], task: { id: "task-id", projectId: "project-id", title: "Add task view", description: "Display tasks", sourceRunId: null }, linked: { id: "link-id", projectId: "project-id", githubId: BigInt(7), fullName: "owner/repo" }, events: [] as Record<string, unknown>[] }));

vi.mock("@/lib/access", () => ({ projectForOwner: vi.fn(async () => state.owner ? { id: "project-id" } : null) }));
vi.mock("@/lib/github", () => ({ githubToken: vi.fn() }));
vi.mock("./proposal", () => ({ generateDeveloperProposal: vi.fn() }));
vi.mock("@/lib/db", () => {
  const client = {
    task: { findFirst: vi.fn(async ({ where }: any) => where.id === state.task.id && where.projectId === state.task.projectId ? state.task : null) },
    gitHubRepository: { findUnique: vi.fn(async () => state.linked) },
    developerExecution: {
      findFirst: vi.fn(async ({ where }: any) => state.executions.find(item => item.projectId === where.projectId && item.taskId === where.taskId) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => state.executions.find(item => item.id === where.id)),
      create: vi.fn(async ({ data }: any) => { const row = { ...data, status: "PROPOSED", startedAt: null, commitSha: null, pullNumber: null, updatedAt: new Date() }; state.executions.push(row); return row; }),
      update: vi.fn(async ({ where, data }: any) => { const row = state.executions.find(item => item.id === where.id)!; Object.assign(row, data); return row; }),
    },
    approvalRequest: {
      create: vi.fn(async ({ data }: any) => { const row = { ...data, id: crypto.randomUUID(), status: "PENDING", updatedAt: new Date(), decidedById: null }; state.approvals.push(row); return row; }),
      findFirst: vi.fn(async ({ where }: any) => { const row = state.approvals.find(item => item.id === where.id && item.projectId === where.projectId && (!where.action || item.action === where.action)); return row ? { ...row, execution: state.executions.find(item => item.id === row.executionId) } : null; }),
      updateMany: vi.fn(async ({ where, data }: any) => { const row = state.approvals.find(item => item.id === where.id && item.projectId === where.projectId && (where.status ? item.status === where.status : where.OR?.some((clause: any) => item.status === clause.status && (!clause.updatedAt || item.updatedAt < clause.updatedAt.lt))) && (!where.updatedAt || item.updatedAt === where.updatedAt) && (!where.decidedById || item.decidedById === where.decidedById)); if (!row) return { count: 0 }; Object.assign(row, data, { updatedAt: new Date() }); return { count: 1 }; }),
      update: vi.fn(async ({ where, data }: any) => { const row = state.approvals.find(item => item.id === where.id)!; Object.assign(row, data, { updatedAt: new Date() }); return row; }),
      upsert: vi.fn(async ({ where, create }: any) => { const row = state.approvals.find(item => item.executionId === where.executionId_action.executionId && item.action === where.executionId_action.action); if (row) return row; const fresh = { ...create, id: crypto.randomUUID(), status: "PENDING", updatedAt: new Date(), decidedById: null }; state.approvals.push(fresh); return fresh; }),
    },
    activityEvent: { create: vi.fn(async ({ data }: any) => { state.events.push(data); }) },
  };
  return { db: { ...client, $transaction: async (work: (tx: typeof client) => Promise<unknown>) => { if (state.failTransaction) throw new Error("private database URL leaked in raw error"); return work(client); } } };
});

import { createDeveloperProposal, decideApproval, executeImplementation, executeMerge, retryApproval } from "./runtime";

const baseSha = "a".repeat(40);
const commitSha = "b".repeat(40);
const proposal = { task: "Add task view", summary: "Create a task view with a simple existing task list.", files: [{ path: "src/app/tasks/page.tsx", content: "export default function Tasks() { return <main>Tasks</main>; }", reason: "Add the task view page" }], validationPlan: "Run CI and review the complete change in the PR.", risks: "The task API may require additional access control.", commitMessage: "feat: add task view page" };

function fakeGitHub() {
  let branch: string | null = null;
  let pull: PullInfo | null = null;
  const github: DeveloperGitHub = {
    repository: vi.fn(async () => ({ id: 7, full_name: "owner/repo", default_branch: "main", permissions: { push: true } })),
    ref: vi.fn(async (_, name) => name === "dev" ? baseSha : branch),
    context: vi.fn(async () => ({ paths: [], files: [] })),
    createBranch: vi.fn(async (_, name, sha) => { expect(name).toMatch(/^forge\//); branch = sha; }),
    createCommit: vi.fn(async () => commitSha),
    updateBranch: vi.fn(async () => { branch = commitSha; }),
    findPull: vi.fn(async () => pull),
    createPull: vi.fn(async (_, name, target) => { pull = { number: 14, html_url: "https://github.com/owner/repo/pull/14", state: "open", mergeable: true, merged: false, head: { sha: commitSha, ref: name, repo: { id: 7 } }, base: { ref: target, repo: { id: 7 } } }; return pull; }),
    pull: vi.fn(async () => pull!),
    checks: vi.fn(async () => ({ passed: true, summary: "1 check passed" })),
    merge: vi.fn(async () => { pull = { ...pull!, merged: true, state: "closed" }; }),
  };
  return { github, changePull: (next: Partial<PullInfo>) => { pull = { ...pull!, ...next }; } };
}

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); state.owner = true; state.failTransaction = false; state.approvals.length = 0; state.executions.length = 0; state.events.length = 0; });

describe("approved Developer execution", () => {
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
    await expect(createDeveloperProposal("project-id", "task-id", "user-id", github, async () => proposal)).rejects.toMatchObject({ stage: "repository-validation", code: "UNINSPECTED_OR_UNCHANGED_FILE" });
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
