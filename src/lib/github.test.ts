import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findAccount: vi.fn(), updateAccount: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { account: { findFirst: mocks.findAccount, update: mocks.updateAccount } } }));
import { githubToken } from "./github";

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
});
