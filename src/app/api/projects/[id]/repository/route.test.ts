import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), owner: vi.fn(), repositories: vi.fn(), updateProject: vi.fn(), integration: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/access", () => ({ authenticatedUserId: mocks.user, projectForOwner: mocks.owner }));
vi.mock("@/lib/github", () => ({ listRepositories: mocks.repositories, GitHubIntegrationError: class extends Error {} }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
import { POST } from "./route";

const projectId = "00000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ id: projectId }) };
const request = (body: unknown) => new Request(`http://localhost/api/projects/${projectId}/repository`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue("owner-id");
  mocks.owner.mockResolvedValue({ id: projectId, workspaceId: "workspace-id" });
  mocks.repositories.mockResolvedValue([{ id: 42, full_name: "owner/repository", html_url: "https://github.com/owner/repository", default_branch: "main", private: true }]);
  mocks.transaction.mockImplementation(async operation => operation({ project: { update: mocks.updateProject }, integration: { upsert: mocks.integration } }));
});

describe("repository linking authorization", () => {
  it("requires a real session and never calls GitHub for an anonymous/demo visitor", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request({ repositoryId: 42 }), params)).status).toBe(401);
    expect(mocks.repositories).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("conceals projects belonging to another user", async () => {
    mocks.owner.mockResolvedValue(null);
    expect((await POST(request({ repositoryId: 42 }), params)).status).toBe(404);
    expect(mocks.repositories).not.toHaveBeenCalled();
  });

  it("rejects malformed input and repositories absent from the caller's GitHub account", async () => {
    expect((await POST(request({ repositoryId: "42" }), params)).status).toBe(400);
    expect(mocks.repositories).not.toHaveBeenCalled();
    expect((await POST(request({ repositoryId: 99 }), params)).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("ignores forged repository metadata and repeats ownership in the atomic write", async () => {
    expect((await POST(request({ repositoryId: 42, fullName: "victim/repository", url: "javascript:alert(1)" }), params)).status).toBe(200);
    expect(mocks.repositories).toHaveBeenCalledWith("owner-id");
    expect(mocks.updateProject).toHaveBeenCalledWith({ where: { id: projectId, workspace: { members: { some: { userId: "owner-id", role: "OWNER" } } } }, data: { repositories: { upsert: { where: { projectId }, create: { githubId: BigInt(42), fullName: "owner/repository", url: "https://github.com/owner/repository", defaultBranch: "main" }, update: { githubId: BigInt(42), fullName: "owner/repository", url: "https://github.com/owner/repository", defaultBranch: "main" } } } } });
    expect(mocks.integration).toHaveBeenCalledOnce();
  });

  it("returns a safe error if a database write fails", async () => {
    mocks.updateProject.mockRejectedValue(new Error("private connection details"));
    const response = await POST(request({ repositoryId: 42 }), params);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Could not link the GitHub repository. Try again." });
    expect(mocks.integration).not.toHaveBeenCalled();
  });
});
