import { afterAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { db: new PrismaClient() };
});
vi.mock("../../src/lib/agents/provider", () => ({ AiProviderError: class AiProviderError extends Error {}, provider: () => ({ name: "fake", model: "fake", generate: mocks.generate }) }));

import { db } from "@/lib/db";
import { advanceWorkflow } from "../../src/lib/agents/runtime";
import { tools } from "../../src/lib/agents/tools";

// This test creates and removes an isolated fixture in the configured database.
const integration = process.env.RUN_DB_INTEGRATION === "true" ? describe : describe.skip;
afterAll(async () => { await db.$disconnect(); });

integration("agent output persistence", () => {
  it("persists failures without partial content and keeps successful retries idempotent", async () => {
    const workspace = await db.workspace.create({ data: { name: "Temporary agent output test" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const project = await db.project.create({ data: { workspaceId: workspace.id, name: "Temporary agent output test", goals: { create: { statement: "Build a useful service" } } } });
      const agent = await db.agent.create({ data: { projectId: project.id, type: "FOUNDER" } });
      const createRun = (workflowId: string, step: number) => db.agentRun.create({ data: { projectId: project.id, agentId: agent.id, workflowId, step, type: "FOUNDER", input: { goal: "Build a useful service" } } });

      const invalidWorkflow = crypto.randomUUID();
      const invalidRun = await createRun(invalidWorkflow, 0);
      const skippedRun = await createRun(invalidWorkflow, 1);
      mocks.generate.mockResolvedValueOnce({ summary: "Invalid", tasks: [], reports: [], metrics: [{ key: "../unsafe", label: "Unsafe", value: 1, unit: "" }] });
      await expect(advanceWorkflow(project.id, invalidWorkflow)).rejects.toThrow();
      expect((await db.agentRun.findUniqueOrThrow({ where: { id: invalidRun.id } })).status).toBe("FAILED");
      expect((await db.agentRun.findUniqueOrThrow({ where: { id: skippedRun.id } })).status).toBe("FAILED");
      expect(await db.agentEvent.count({ where: { runId: invalidRun.id, kind: "failed" } })).toBe(1);
      expect(await db.task.count({ where: { projectId: project.id } })).toBe(0);
      expect(await db.metric.count({ where: { projectId: project.id } })).toBe(0);

      const rollbackWorkflow = crypto.randomUUID();
      const rollbackRun = await createRun(rollbackWorkflow, 0);
      const valid = { summary: "Ready", tasks: [{ title: "Interview users", description: "Ask about workflows" }], reports: [{ title: "Plan", kind: "strategy", content: "A focused test plan" }], metrics: [{ key: "Monthly Active Users", label: "Monthly active users", value: 12, unit: "" }] };
      mocks.generate.mockResolvedValueOnce(valid);
      const saveMetric = vi.spyOn(tools, "saveMetric").mockRejectedValueOnce(new Error("synthetic write failure"));
      await expect(advanceWorkflow(project.id, rollbackWorkflow)).rejects.toThrow("synthetic write failure");
      saveMetric.mockRestore();
      expect((await db.agentRun.findUniqueOrThrow({ where: { id: rollbackRun.id } })).status).toBe("FAILED");
      expect(await db.task.count({ where: { projectId: project.id } })).toBe(0);
      expect(await db.report.count({ where: { projectId: project.id } })).toBe(0);
      expect(await db.metric.count({ where: { projectId: project.id } })).toBe(0);

      const successWorkflow = crypto.randomUUID();
      const successRun = await createRun(successWorkflow, 0);
      mocks.generate.mockResolvedValueOnce(valid);
      await advanceWorkflow(project.id, successWorkflow);
      expect((await db.agentRun.findUniqueOrThrow({ where: { id: successRun.id } })).status).toBe("COMPLETED");
      expect(await db.task.count({ where: { projectId: project.id } })).toBe(1);
      expect(await db.report.count({ where: { projectId: project.id } })).toBe(1);
      expect(await db.metric.findUnique({ where: { projectId_key: { projectId: project.id, key: "monthly_active_users" } } })).not.toBeNull();
      expect(await advanceWorkflow(project.id, successWorkflow)).toBeNull();
      expect(await db.task.count({ where: { projectId: project.id } })).toBe(1);

      const conflictWorkflow = crypto.randomUUID();
      const conflictRun = await createRun(conflictWorkflow, 0);
      mocks.generate.mockResolvedValueOnce({ summary: "Conflicting metric", tasks: [], reports: [], metrics: [{ key: "monthly-active-users", label: "Different measurement", value: 99, unit: "" }] });
      await expect(advanceWorkflow(project.id, conflictWorkflow)).rejects.toThrow("different label or unit");
      expect((await db.agentRun.findUniqueOrThrow({ where: { id: conflictRun.id } })).status).toBe("FAILED");
      const metric = await db.metric.findUniqueOrThrow({ where: { projectId_key: { projectId: project.id, key: "monthly_active_users" } } });
      expect(metric.value).toBe(12);
      expect(metric.label).toBe("Monthly active users");
    } finally {
      log.mockRestore();
      await db.workspace.delete({ where: { id: workspace.id } });
    }
  }, 30_000);
});
