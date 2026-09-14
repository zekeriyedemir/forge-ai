import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findAccount: vi.fn(), updateAccount: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { account: { findFirst: mocks.findAccount, update: mocks.updateAccount } } }));
import { githubToken, listRepositories } from "./github";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.env.AUTH_GITHUB_ID = "test-client";
  process.env.AUTH_GITHUB_SECRET = "test-secret";
});

describe("GitHub token handling", () => {
  it("uses an unexpired stored token without a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.findAccount.mockResolvedValue({ providerAccountId: "account", access_token: "current", refresh_token: "refresh", expires_at: Math.floor(Date.now() / 1000) + 3600 });
    expect(await githubToken("user-id")).toBe("current");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renews an expired token and stores the rotated pair", async () => {
    mocks.findAccount.mockResolvedValue({ providerAccountId: "account", access_token: "expired", refresh_token: "old-refresh", expires_at: 1 });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 28800 }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await githubToken("user-id")).toBe("new-token");
    expect(mocks.updateAccount).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ access_token: "new-token", refresh_token: "new-refresh" }) }));
    expect(fetchMock.mock.calls[0][0]).toBe("https://github.com/login/oauth/access_token");
  });

  it("asks for reauthentication when renewal is impossible", async () => {
    mocks.findAccount.mockResolvedValue({ providerAccountId: "account", access_token: "expired", refresh_token: null, expires_at: 1 });
    await expect(githubToken("user-id")).rejects.toThrow("Sign out and sign in again");
  });

  it("rejects a missing access token without calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.findAccount.mockResolvedValue({ access_token: null });
    await expect(listRepositories("user-id")).rejects.toThrow("GitHub access is missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the persisted token to list both public and private repositories", async () => {
    mocks.findAccount.mockResolvedValue({ access_token: "stored-token", expires_at: null });
    const repositories = [{ id: 1, private: false }, { id: 2, private: true }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => repositories });
    vi.stubGlobal("fetch", fetchMock);
    expect(await listRepositories("user-id")).toEqual(repositories);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/user/repos?"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer stored-token" }) }));
  });

  it("asks for a new sign-in when GitHub rejects the persisted token", async () => {
    mocks.findAccount.mockResolvedValue({ access_token: "invalid-token", expires_at: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(listRepositories("user-id")).rejects.toThrow("authorization is no longer valid");
  });
});
