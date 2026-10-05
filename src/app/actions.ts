"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { authenticatedUserId, projectForOwner, requireUser, workspaceForUser } from "@/lib/access";
import { goalInput, projectInput } from "@/lib/validation";

export async function createProject(formData: FormData) {
  const userId = await requireUser();
  const parsed = projectInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Enter a project name (2–80 characters), a goal (10–2,000 characters), and a description of up to 2,000 characters.");
  const input = parsed.data;
  const workspace = await workspaceForUser(userId);
  const project = await db.project.create({ data: { workspaceId: workspace.id, name: input.name, description: input.description, goals: { create: { statement: input.goal } }, activity: { create: { kind: "project", message: "Project created" } } } });
  revalidatePath("/dashboard/projects");
  redirect(`/dashboard/projects/${project.id}`);
}

export async function addGoal(projectId: string, formData: FormData) {
  const userId = await requireUser();
  if (!await projectForOwner(projectId, userId)) throw new Error("Project not found or access denied");
  const parsed = goalInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Enter a goal between 10 and 2,000 characters.");
  // Authorize the nested writes in the same statement so a revoked membership cannot race the check.
  await db.project.update({ where: { id: projectId, workspace: { members: { some: { userId, role: "OWNER" } } } }, data: { goals: { create: { statement: parsed.data.statement } }, activity: { create: { kind: "goal", message: "Business goal updated" } } } });
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function updateTask(projectId: string, taskId: string, formData: FormData) {
  const userId = await requireUser();
  if (!await projectForOwner(projectId, userId)) throw new Error("Project not found or access denied");
  const status = formData.get("status");
  if (status !== "TODO" && status !== "IN_PROGRESS" && status !== "DONE") throw new Error("Invalid task status");
  await db.task.update({ where: { id: taskId, projectId, project: { workspace: { members: { some: { userId, role: "OWNER" } } } } }, data: { status } });
  revalidatePath(`/dashboard/projects/${projectId}/tasks`);
}

export async function deleteProject(projectId: string, formData: FormData) {
  const userId = await authenticatedUserId();
  if (!userId) redirect("/login");
  const project = await projectForOwner(projectId, userId);
  if (!project) throw new Error("Project not found or access denied");
  if (formData.get("confirmation") !== project.name) throw new Error("Type the exact project name to confirm deletion");
  // The owner predicate is repeated in the delete so membership changes cannot bypass the check.
  // PostgreSQL cascades all project-owned rows through the Prisma foreign keys.
  const result = await db.project.deleteMany({ where: { id: projectId, name: project.name, workspace: { members: { some: { userId, role: "OWNER" } } } } });
  if (result.count !== 1) throw new Error("Project not found or access denied");
  revalidatePath("/dashboard/projects");
  redirect("/dashboard/projects?deleted=1");
}
