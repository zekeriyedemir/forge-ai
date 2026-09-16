import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/github", () => ({ githubToken: vi.fn() }));
import { GitHubDeveloperClient } from "./github";

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
