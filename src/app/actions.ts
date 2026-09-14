"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireProject, requireUser, workspaceForUser } from "@/lib/access";
import { goalInput, projectInput } from "@/lib/validation";

export async function createProject(formData: FormData) {
  const userId = await requireUser();
  const input = projectInput.parse(Object.fromEntries(formData));
  const workspace = await workspaceForUser(userId);
  const project = await db.project.create({ data: { workspaceId: workspace.id, name: input.name, description: input.description, goals: { create: { statement: input.goal } }, activity: { create: { kind: "project", message: "Project created" } } } });
  revalidatePath("/dashboard/projects");
  redirect(`/dashboard/projects/${project.id}`);
}

export async function addGoal(projectId: string, formData: FormData) {
  await requireProject(projectId);
  const input = goalInput.parse(Object.fromEntries(formData));
  await db.businessGoal.create({ data: { projectId, statement: input.statement } });
  await db.activityEvent.create({ data: { projectId, kind: "goal", message: "Business goal updated" } });
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function updateTask(projectId: string, taskId: string, formData: FormData) {
  await requireProject(projectId);
  const status = formData.get("status");
  if (status !== "TODO" && status !== "IN_PROGRESS" && status !== "DONE") throw new Error("Invalid task status");
  await db.task.update({ where: { id: taskId, projectId }, data: { status } });
  revalidatePath(`/dashboard/projects/${projectId}/tasks`);
}
