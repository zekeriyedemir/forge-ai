import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/github", () => ({ githubToken: vi.fn() }));
import { extractSafeDiagnostics, GitHubDeveloperClient, selectContextPaths } from "./github";

afterEach(() => vi.unstubAllGlobals());

describe("bounded GitHub writes", () => {
  it("never creates or updates protected branches directly", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new GitHubDeveloperClient("test-only");
    await expect(client.createBranch("owner/repo", "main", "a".repeat(40))).rejects.toThrow();
    await expect(client.updateBranch("owner/repo", "dev", "a".repeat(40))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a non-force reference update for a Forge branch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ object: { sha: "b".repeat(40) } }) });
    vi.stubGlobal("fetch", fetchMock);
    await new GitHubDeveloperClient("test-only").updateBranch("owner/repo", "forge/task-abcdef12", "b".repeat(40));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sha: "b".repeat(40), force: false });
  });

  it("requires a configured passing check before merge eligibility", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ total_count: 0, check_runs: [] }) }).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: "pending", total_count: 0 }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await new GitHubDeveloperClient("test-only").checks("owner/repo", "a".repeat(40))).toEqual({ passed: false, summary: "No remote checks are configured; merge is blocked." });
  });

  it("hides GitHub error bodies and reports permission failures safely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "secret response body" }));
    await expect(new GitHubDeveloperClient("test-only").repository("owner/repo")).rejects.toThrow("GitHub denied this operation");
  });

  it("inspects the commit's tree and excludes symlinks from editable contents", async () => {
    const commitSha = "a".repeat(40);
    const treeSha = "b".repeat(40);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: commitSha, tree: { sha: treeSha } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ truncated: false, tree: [
        { path: "src/app/page.tsx", type: "blob", mode: "100644", size: 30 },
        { path: "src/app/link.ts", type: "blob", mode: "120000", size: 20 },
      ] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ encoding: "base64", content: Buffer.from("export default function Page() {}").toString("base64") }) });
    vi.stubGlobal("fetch", fetchMock);
    const context = await new GitHubDeveloperClient("test-only").context("owner/repo", commitSha, "Change page");
    expect(fetchMock.mock.calls[1][0]).toContain(`/git/trees/${treeSha}`);
    expect(context.paths).toContain("src/app/link.ts");
    expect(context.files.map(file => file.path)).toEqual(["src/app/page.tsx"]);
  });
});

describe("task-aware inspection and CI", () => {
  it("selects related source and tests within the bounded context", () => {
    const tree = ["src/lib/payments.ts", "src/lib/payments.test.ts", "src/app/page.tsx", "src/app/page.test.tsx", "src/lib/api_key.ts", "package.json", "tsconfig.json"].map(path => ({ path, type: "blob", mode: "100644", size: 100 }));
    const selected = selectContextPaths(tree, "Fix payments calculation and tests").map(item => item.path);
    expect(selected.slice(0, 2)).toEqual(["src/lib/payments.test.ts", "src/lib/payments.ts"]);
    expect(selected).toContain("package.json");
    expect(selected).not.toContain("src/lib/api_key.ts");
  });

  it("follows a nearby relative import when the task-selected file references it", async () => {
    const sha = "a".repeat(40);
    const paths = ["src/lib/payments.ts", "src/lib/payments.test.ts", "src/lib/payments-a.ts", "src/lib/payments-b.ts", "src/lib/payments-c.ts", "src/lib/payments-d.ts", "src/lib/shared/round.ts"];
    const fetchMock = vi.fn(async (input: string) => ({ ok: true, status: 200, json: async () => input.includes("/git/commits/") ? { sha, tree: { sha: "b".repeat(40) } } : input.includes("/git/trees/") ? { truncated: false, tree: paths.map(path => ({ path, type: "blob", mode: "100644", size: 100 })) } : { encoding: "base64", content: Buffer.from(input.includes("payments.ts") ? "import { round } from './shared/round'; export const amount = round(1);" : "export const round = (x: number) => x;").toString("base64") } }));
    vi.stubGlobal("fetch", fetchMock);
    const context = await new GitHubDeveloperClient("test-only").context("owner/repo", sha, "Improve payments tests");
    expect(context.files.map(file => file.path)).toContain("src/lib/shared/round.ts");
    expect(context.files.length).toBeLessThanOrEqual(10);
  });

  it("reduces logs to safe codes and paths, without forwarding credentials or values", () => {
    const log = `DATABASE_URL=postgres://user:secret@db.example/test\nsrc/lib/payments.ts:12 error TS2322: sk-very-secret-value\nFAIL tests/payments.test.ts\n`;
    const diagnostics = extractSafeDiagnostics(log);
    expect(diagnostics).toContain("TypeScript TS2322");
    expect(diagnostics).toContain("File src/lib/payments.ts");
    expect(diagnostics).toContain("Test failure");
    expect(JSON.stringify(diagnostics)).not.toMatch(/secret|postgres|DATABASE_URL/);
    expect(extractSafeDiagnostics("noise\n".repeat(100_000)).length).toBe(0);
    expect(extractSafeDiagnostics(`${"x".repeat(32_000)}\nsrc/lib/payments.ts error TS9999`)).not.toContain("TypeScript TS9999");
  });

  it.each([
    ["PENDING", [{ name: "build", status: "in_progress", conclusion: null }]],
    ["SUCCESS", [{ name: "build", status: "completed", conclusion: "success" }]],
    ["FAILURE", [{ name: "test", status: "completed", conclusion: "failure" }]],
    ["CANCELLED", [{ name: "test", status: "completed", conclusion: "cancelled" }]],
  ])("classifies CI %s", async (state, checkRuns) => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ total_count: 1, check_runs: checkRuns }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: "pending", total_count: 0, statuses: [] }) }));
    expect((await new GitHubDeveloperClient("test-only").ciSnapshot("owner/repo", "a".repeat(40))).state).toBe(state);
  });

  it("marks CI unavailable when no checks exist and handles GitHub API failure", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ total_count: 0, check_runs: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: "pending", total_count: 0, statuses: [] }) }));
    expect((await new GitHubDeveloperClient("test-only").ciSnapshot("owner/repo", "a".repeat(40))).state).toBe("UNAVAILABLE");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(new GitHubDeveloperClient("test-only").ciSnapshot("owner/repo", "a".repeat(40))).rejects.toThrow("GitHub denied");
  });

  it("reads a bounded redirected Actions log without forwarding the OAuth token to the signed URL", async () => {
    const sha = "a".repeat(40);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ workflow_runs: [{ id: 1, head_sha: sha, conclusion: "failure", name: "CI" }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jobs: [{ id: 2, name: "build", conclusion: "failure", steps: [{ name: "typecheck", conclusion: "failure" }] }] }) })
      .mockResolvedValueOnce({ status: 302, headers: { get: () => "https://logs.blob.core.windows.net/result?sig=sensitive" } })
      .mockResolvedValueOnce({ ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("src/lib/payments.ts:1 error TS2322: sk-secret\n")); controller.close(); } }) });
    vi.stubGlobal("fetch", fetchMock);
    const failure = await new GitHubDeveloperClient("test-only").ciFailure("owner/repo", sha);
    expect(failure.diagnostics).toContain("TypeScript TS2322");
    expect(failure.diagnostics.join(" ")).not.toContain("sk-secret");
    expect(fetchMock.mock.calls[3][1].headers).toBeUndefined();
  });
});
