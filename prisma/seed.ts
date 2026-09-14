import { db } from "../src/lib/db";

async function main() {
  const user = await db.user.upsert({ where: { email: "demo@forge.local" }, update: {}, create: { email: "demo@forge.local", name: "Demo Founder" } });
  let membership = await db.workspaceMember.findFirst({ where: { userId: user.id } });
  if (!membership) {
    const workspace = await db.workspace.create({ data: { name: "Demo Workspace", members: { create: { userId: user.id, role: "OWNER" } } } });
    membership = await db.workspaceMember.findFirstOrThrow({ where: { userId: user.id, workspaceId: workspace.id } });
  }
  const exists = await db.project.findFirst({ where: { workspaceId: membership.workspaceId, name: "Atlas AI" } });
  if (!exists) await db.project.create({ data: { workspaceId: membership.workspaceId, name: "Atlas AI", description: "A sample project ready for the Forge workflow.", goals: { create: { statement: "Build an AI SaaS that can reach €5,000 monthly recurring revenue." } }, activity: { create: { kind: "project", message: "Demo project created" } } } });
}
main().finally(() => db.$disconnect());
