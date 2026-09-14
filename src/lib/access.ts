import { auth } from "@/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export async function currentUserId() {
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  if (process.env.DEMO_MODE === "true") {
    const user = await db.user.upsert({ where: { email: "demo@forge.local" }, update: {}, create: { email: "demo@forge.local", name: "Demo Founder" } });
    return user.id;
  }
  return null;
}

export async function requireUser() {
  const id = await currentUserId();
  if (!id) redirect("/login");
  return id;
}

export async function projectForUser(projectId: string, userId: string) {
  return db.project.findFirst({ where: { id: projectId, workspace: { members: { some: { userId } } } } });
}

export async function projectForOwner(projectId: string, userId: string) {
  return db.project.findFirst({ where: { id: projectId, workspace: { members: { some: { userId, role: "OWNER" } } } } });
}

export async function requireProject(projectId: string) {
  const userId = await requireUser();
  const project = await projectForUser(projectId, userId);
  if (!project) throw new Error("Project not found or access denied");
  return project;
}

export async function requireProjectOwner(projectId: string) {
  const userId = await requireUser();
  const project = await projectForOwner(projectId, userId);
  if (!project) throw new Error("Project not found or access denied");
  return project;
}

export async function workspaceForUser(userId: string) {
  const member = await db.workspaceMember.findFirst({ where: { userId, role: "OWNER" }, include: { workspace: true } });
  if (member) return member.workspace;
  return db.workspace.create({ data: { name: "My Workspace", members: { create: { userId, role: "OWNER" } } } });
}
