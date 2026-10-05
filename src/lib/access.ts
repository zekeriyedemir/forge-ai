import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { notFound, redirect } from "next/navigation";

export async function authenticatedUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function currentUserId() {
  const userId = await authenticatedUserId();
  if (userId) return userId;
  // Shared sample data is a local development convenience, never a production identity.
  if (process.env.DEMO_MODE === "true" && ["development", "test"].includes(process.env.NODE_ENV ?? "")) {
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
  if (!project) notFound();
  return project;
}

export async function requireProjectOwner(projectId: string) {
  const userId = await requireUser();
  const project = await projectForOwner(projectId, userId);
  if (!project) throw new Error("Project not found or access denied");
  return project;
}

export async function workspaceForUser(userId: string) {
  // Serializable isolation makes simultaneous first visits converge on one workspace.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const member = await tx.workspaceMember.findFirst({ where: { userId, role: "OWNER" }, include: { workspace: true } });
        if (member) return member.workspace;
        return tx.workspace.create({ data: { name: "My Workspace", members: { create: { userId, role: "OWNER" } } } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new Error("Your workspace could not be opened. Please try again.");
}
