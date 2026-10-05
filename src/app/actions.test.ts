import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), requireUser: vi.fn(), workspace: vi.fn(), ownerProject: vi.fn(), deleteMany: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), updateTask: vi.fn(), revalidate: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/access", () => ({ authenticatedUserId: mocks.user, projectForOwner: mocks.ownerProject, requireUser: mocks.requireUser, workspaceForUser: mocks.workspace }));
vi.mock("@/lib/db", () => ({ db: { project: { deleteMany: mocks.deleteMany, create: mocks.createProject, update: mocks.updateProject }, task: { update: mocks.updateTask } } }));
vi.mock("@/lib/validation", () => import("../lib/validation"));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { mocks.redirect(path); throw new Error(`redirect:${path}`); } }));
import { addGoal, createProject, deleteProject, updateTask } from "./actions";

const projectId = "00000000-0000-4000-8000-000000000001";
function confirmation(value: string) { const form = new FormData(); form.set("confirmation", value); return form; }
beforeEach(() => { vi.clearAllMocks(); mocks.ownerProject.mockResolvedValue({ id: projectId, name: "Atlas" }); mocks.deleteMany.mockResolvedValue({ count: 1 }); mocks.requireUser.mockResolvedValue("owner-id"); mocks.workspace.mockResolvedValue({ id: "workspace-id" }); mocks.createProject.mockResolvedValue({ id: projectId }); });

describe("project and task mutations", () => {
  it("validates and trims project creation before attaching it to the caller's owned workspace", async () => {
    const form = new FormData();
    form.set("name", "  Atlas  "); form.set("goal", "  Validate the product with five customers  "); form.set("description", "Initial research");
    await expect(createProject(form)).rejects.toThrow(`redirect:/dashboard/projects/${projectId}`);
    expect(mocks.workspace).toHaveBeenCalledWith("owner-id");
    expect(mocks.createProject).toHaveBeenCalledWith({ data: { workspaceId: "workspace-id", name: "Atlas", description: "Initial research", goals: { create: { statement: "Validate the product with five customers" } }, activity: { create: { kind: "project", message: "Project created" } } } });
  });

  it("rejects missing login and malformed project input without database writes", async () => {
    await expect(createProject(new FormData())).rejects.toThrow("Enter a project name");
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.createProject).not.toHaveBeenCalled();
    mocks.requireUser.mockRejectedValueOnce(new Error("redirect:/login"));
    await expect(createProject(new FormData())).rejects.toThrow("redirect:/login");
  });

  it("rejects another user's project before changing tasks or goals", async () => {
    mocks.ownerProject.mockResolvedValue(null);
    await expect(addGoal(projectId, new FormData())).rejects.toThrow("access denied");
    await expect(updateTask(projectId, "foreign-task", new FormData())).rejects.toThrow("access denied");
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });

  it("creates a goal and its activity atomically with a current owner predicate", async () => {
    const form = new FormData(); form.set("statement", "Interview five customers");
    await addGoal(projectId, form);
    expect(mocks.updateProject).toHaveBeenCalledWith({ where: { id: projectId, workspace: { members: { some: { userId: "owner-id", role: "OWNER" } } } }, data: { goals: { create: { statement: "Interview five customers" } }, activity: { create: { kind: "goal", message: "Business goal updated" } } } });
  });

  it("keeps a task update inside the authorized project and rejects invalid statuses", async () => {
    const form = new FormData(); form.set("status", "DONE");
    await updateTask(projectId, "task-id", form);
    expect(mocks.updateTask).toHaveBeenCalledWith({ where: { id: "task-id", projectId, project: { workspace: { members: { some: { userId: "owner-id", role: "OWNER" } } } } }, data: { status: "DONE" } });
    form.set("status", "ADMIN");
    await expect(updateTask(projectId, "task-id", form)).rejects.toThrow("Invalid task status");
    expect(mocks.updateTask).toHaveBeenCalledTimes(1);
  });
});

describe("project deletion", () => {
  it("lets the owner delete after typing the exact name, then redirects", async () => {
    mocks.user.mockResolvedValue("owner-id");
    await expect(deleteProject(projectId, confirmation("Atlas"))).rejects.toThrow("redirect:/dashboard/projects?deleted=1");
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
