import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), ownerProject: vi.fn(), deleteMany: vi.fn(), revalidate: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/access", () => ({ authenticatedUserId: mocks.user, projectForOwner: mocks.ownerProject }));
vi.mock("@/lib/db", () => ({ db: { project: { deleteMany: mocks.deleteMany } } }));
vi.mock("@/lib/validation", () => ({ goalInput: {}, projectInput: {} }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { mocks.redirect(path); throw new Error(`redirect:${path}`); } }));
import { deleteProject } from "./actions";

const projectId = "00000000-0000-4000-8000-000000000001";
function confirmation(value: string) { const form = new FormData(); form.set("confirmation", value); return form; }
beforeEach(() => { vi.clearAllMocks(); mocks.ownerProject.mockResolvedValue({ id: projectId, name: "Atlas" }); mocks.deleteMany.mockResolvedValue({ count: 1 }); });

describe("project deletion", () => {
  it("lets the owner delete after typing the exact name, then redirects", async () => {
    mocks.user.mockResolvedValue("owner-id");
    await expect(deleteProject(projectId, confirmation("Atlas"))).rejects.toThrow("redirect:/dashboard/projects");
    expect(mocks.ownerProject).toHaveBeenCalledWith(projectId, "owner-id");
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: projectId, name: "Atlas", workspace: { members: { some: { userId: "owner-id", role: "OWNER" } } } } });
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/projects");
  });

  it("rejects an anonymous visitor before deleting", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(deleteProject(projectId, confirmation("Atlas"))).rejects.toThrow("redirect:/login");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a user who changes the project ID to someone else's project", async () => {
    mocks.user.mockResolvedValue("other-user");
    mocks.ownerProject.mockResolvedValue(null);
    await expect(deleteProject(projectId, confirmation("Atlas"))).rejects.toThrow("access denied");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("requires an exact confirmation and fails closed if ownership changes", async () => {
    mocks.user.mockResolvedValue("owner-id");
    await expect(deleteProject(projectId, confirmation("Wrong"))).rejects.toThrow("exact project name");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteProject(projectId, confirmation("Atlas"))).rejects.toThrow("access denied");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
