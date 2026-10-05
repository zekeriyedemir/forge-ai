import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), project: vi.fn(), membership: vi.fn(), createWorkspace: vi.fn(), demoUser: vi.fn(), transaction: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { project: { findFirst: mocks.project }, workspaceMember: { findFirst: mocks.membership }, workspace: { create: mocks.createWorkspace }, user: { upsert: mocks.demoUser }, $transaction: mocks.transaction } }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirected to login"); }, notFound: () => { throw new Error("not found:404"); } }));
import { currentUserId, projectForOwner, requireProject, requireProjectOwner, workspaceForUser } from "./access";

beforeEach(() => { vi.clearAllMocks(); process.env.DEMO_MODE = "false"; mocks.transaction.mockImplementation(operation => operation({ workspaceMember: { findFirst: mocks.membership }, workspace: { create: mocks.createWorkspace } })); });
afterEach(() => vi.unstubAllEnvs());

describe("server-side access", () => {
  it("never creates an anonymous production identity even when demo mode is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    mocks.auth.mockResolvedValue(null);
    expect(await currentUserId()).toBeNull();
    expect(mocks.demoUser).not.toHaveBeenCalled();
  });

  it("allows an explicit local demo while preferring real authenticated users", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEMO_MODE", "true");
    mocks.auth.mockResolvedValueOnce({ user: { id: "real-user" } }).mockResolvedValueOnce(null);
    mocks.demoUser.mockResolvedValue({ id: "local-demo" });
    expect(await currentUserId()).toBe("real-user");
    expect(mocks.demoUser).not.toHaveBeenCalled();
    expect(await currentUserId()).toBe("local-demo");
  });
  it("requires login when demo mode is disabled", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await currentUserId()).toBeNull();
    await expect(requireProjectOwner("project-id")).rejects.toThrow("redirected to login");
    expect(mocks.project).not.toHaveBeenCalled();
  });

  it("scopes writes to an owner membership", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-id" } });
    mocks.project.mockResolvedValue(null);
    await expect(requireProjectOwner("project-id")).rejects.toThrow("access denied");
    expect(mocks.project).toHaveBeenCalledWith({ where: { id: "project-id", workspace: { members: { some: { userId: "user-id", role: "OWNER" } } } } });
    await projectForOwner("project-id", "user-id");
  });

  it("returns a not-found response when a signed-in user cannot read a project", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-id" } });
    mocks.project.mockResolvedValue(null);
    await expect(requireProject("project-id")).rejects.toThrow("not found:404");
  });

  it("creates a separate workspace when the user has no owner membership", async () => {
    mocks.membership.mockResolvedValue(null);
    mocks.createWorkspace.mockResolvedValue({ id: "owned-workspace" });
    expect(await workspaceForUser("user-id")).toEqual({ id: "owned-workspace" });
    expect(mocks.membership).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-id", role: "OWNER" } }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("retries a concurrent first-workspace conflict and returns the existing winner", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("Write conflict", { code: "P2034", clientVersion: "test" });
    mocks.transaction.mockRejectedValueOnce(conflict);
    mocks.membership.mockResolvedValue({ workspace: { id: "winning-workspace" } });
    expect(await workspaceForUser("user-id")).toEqual({ id: "winning-workspace" });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });

  it("does not endlessly retry persistent transaction conflicts", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("Write conflict", { code: "P2034", clientVersion: "test" });
    mocks.transaction.mockRejectedValue(conflict);
    await expect(workspaceForUser("user-id")).rejects.toThrow("Write conflict");
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });
});
