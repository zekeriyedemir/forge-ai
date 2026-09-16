import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/access", () => ({ authenticatedUserId: mocks.user }));
vi.mock("@/lib/github", () => ({ listRepositories: mocks.list, GitHubIntegrationError: class GitHubIntegrationError extends Error {} }));
import { GitHubIntegrationError } from "@/lib/github";
import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GitHub repository route", () => {
  it("returns public and private repositories for the authenticated user", async () => {
    mocks.user.mockResolvedValue("signed-in-user");
    mocks.list.mockResolvedValue([
      { id: 1, full_name: "owner/public", html_url: "https://github.com/owner/public", private: false },
      { id: 2, full_name: "owner/private", html_url: "https://github.com/owner/private", private: true },
    ]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ repositories: expect.arrayContaining([expect.objectContaining({ private: false }), expect.objectContaining({ private: true })]) });
    expect(mocks.list).toHaveBeenCalledWith("signed-in-user");
  });

  it("rejects a demo-only or anonymous visitor without touching GitHub", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it.each(["GitHub access is missing. Sign out and sign in with GitHub again.", "GitHub authorization is no longer valid. Sign out and sign in again."])("returns a safe error for a missing or invalid token", async message => {
    mocks.user.mockResolvedValue("signed-in-user");
    mocks.list.mockRejectedValue(new GitHubIntegrationError(message));
    const response = await GET();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: message });
  });

  it("does not expose unexpected server errors to the browser", async () => {
    mocks.user.mockResolvedValue("signed-in-user");
    mocks.list.mockRejectedValue(new Error("internal database connection details"));
    const response = await GET();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Could not load GitHub repositories. Try again." });
  });
});
