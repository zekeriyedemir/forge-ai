import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), project: vi.fn(), membership: vi.fn(), createWorkspace: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { project: { findFirst: mocks.project }, workspaceMember: { findFirst: mocks.membership }, workspace: { create: mocks.createWorkspace } } }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirected to login"); } }));
import { currentUserId, projectForOwner, requireProjectOwner, workspaceForUser } from "./access";

beforeEach(() => { vi.clearAllMocks(); process.env.DEMO_MODE = "false"; });

describe("server-side access", () => {
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

  it("creates a separate workspace when the user has no owner membership", async () => {
    mocks.membership.mockResolvedValue(null);
    mocks.createWorkspace.mockResolvedValue({ id: "owned-workspace" });
    expect(await workspaceForUser("user-id")).toEqual({ id: "owned-workspace" });
    expect(mocks.membership).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-id", role: "OWNER" } }));
  });
});
