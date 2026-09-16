import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

// Opt in with RUN_DB_INTEGRATION=true and a disposable or explicitly approved database.
const integration = process.env.RUN_DB_INTEGRATION === "true" ? describe : describe.skip;
const db = new PrismaClient();
afterAll(async () => { await db.$disconnect(); });

integration("project deletion cascades", () => {
  it("keeps an unauthorized project, then removes every dependent record for its owner", async () => {
    const user = await db.user.create({ data: { email: `forge-delete-test-${crypto.randomUUID()}@example.invalid` } });
    let workspaceId: string | undefined;
    try {
      const workspace = await db.workspace.create({ data: { name: "Temporary deletion test", members: { create: { userId: user.id, role: "OWNER" } } } });
      workspaceId = workspace.id;
      const project = await db.project.create({ data: { workspaceId, name: "Temporary deletion test" } });
      const agent = await db.agent.create({ data: { projectId: project.id, type: "FOUNDER" } });
      const run = await db.agentRun.create({ data: { projectId: project.id, agentId: agent.id, workflowId: crypto.randomUUID(), step: 0, type: "FOUNDER", input: {} } });
      await Promise.all([
        db.businessGoal.create({ data: { projectId: project.id, statement: "Test goal" } }),
        db.agentEvent.create({ data: { runId: run.id, kind: "test", message: "Test event" } }),
        db.task.create({ data: { projectId: project.id, title: "Test task" } }),
        db.report.create({ data: { projectId: project.id, title: "Test report", kind: "test", content: "Test" } }),
        db.metric.create({ data: { projectId: project.id, key: "test", label: "Test", value: 1 } }),
        db.gitHubRepository.create({ data: { projectId: project.id, githubId: BigInt(1), fullName: "test/repo", url: "https://example.invalid/repo", defaultBranch: "main" } }),
        db.activityEvent.create({ data: { projectId: project.id, kind: "test", message: "Test activity" } }),
      ]);

      const ownerWhere = { id: project.id, workspace: { members: { some: { userId: user.id, role: "OWNER" } } } };
      expect((await db.project.deleteMany({ where: { ...ownerWhere, workspace: { members: { some: { userId: crypto.randomUUID(), role: "OWNER" } } } } })).count).toBe(0);
      expect(await db.project.count({ where: { id: project.id } })).toBe(1);
      expect((await db.project.deleteMany({ where: ownerWhere })).count).toBe(1);
      const remaining = await Promise.all([
        db.businessGoal.count({ where: { projectId: project.id } }),
        db.agent.count({ where: { projectId: project.id } }),
        db.agentRun.count({ where: { projectId: project.id } }),
        db.agentEvent.count({ where: { runId: run.id } }),
        db.task.count({ where: { projectId: project.id } }),
        db.report.count({ where: { projectId: project.id } }),
        db.metric.count({ where: { projectId: project.id } }),
        db.gitHubRepository.count({ where: { projectId: project.id } }),
        db.activityEvent.count({ where: { projectId: project.id } }),
      ]);
      expect(remaining).toEqual(Array(9).fill(0));
    } finally {
      if (workspaceId) await db.workspace.delete({ where: { id: workspaceId } });
      await db.user.delete({ where: { id: user.id } });
    }
  });
});
