import { AgentType } from "@prisma/client";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { AiProviderError, provider } from "./provider";
import { MetricKeyConflictError, resultSchema } from "./schemas";
import { tools } from "./tools";

export const sequence: AgentType[] = ["FOUNDER", "RESEARCH", "FOUNDER", "DEVELOPER", "ANALYST"];

export async function startWorkflow(projectId: string) {
  try {
    return await db.$transaction(async tx => {
      const existing = await tx.agentRun.findFirst({ where: { projectId, status: { in: ["PENDING", "RUNNING"] } } });
      if (existing) return existing.workflowId;
      const goal = await tx.businessGoal.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
      if (!goal) throw new Error("Add a business goal before starting the workflow");
      const workflowId = crypto.randomUUID();
      for (const [step, type] of sequence.entries()) {
        const agent = await tx.agent.upsert({ where: { projectId_type: { projectId, type } }, create: { projectId, type }, update: {} });
        await tx.agentRun.create({ data: { projectId, agentId: agent.id, workflowId, step, type, input: { goal: goal.statement } } });
      }
      await tx.activityEvent.create({ data: { projectId, kind: "workflow", message: "Workflow queued" } });
      return workflowId;
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      const existing = await db.agentRun.findFirst({ where: { projectId, status: { in: ["PENDING", "RUNNING"] } } });
      if (existing) return existing.workflowId;
    }
    throw error;
  }
}

export async function advanceWorkflow(projectId: string, workflowId: string) {
  const run = await db.agentRun.findFirst({ where: { projectId, workflowId, status: { in: ["PENDING", "RUNNING"] } }, orderBy: { step: "asc" } });
  if (!run) return null;
  if (run.status === "RUNNING") {
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
    if (!run.startedAt || run.startedAt > staleBefore) return run;
    const recovered = await db.agentRun.updateMany({ where: { id: run.id, status: "RUNNING", startedAt: { lt: staleBefore } }, data: { status: "PENDING", error: "Recovered stale execution" } });
    if (recovered.count === 0) return run;
  }
  const startedAt = new Date();
  const claimed = await db.agentRun.updateMany({ where: { id: run.id, status: "PENDING" }, data: { status: "RUNNING", startedAt, error: null, completedAt: null } });
  if (claimed.count === 0) return run;
  try {
    await db.agentEvent.create({ data: { runId: run.id, kind: "started", message: `${run.type.toLowerCase()} agent started` } });
    const context = await tools.readProjectContext({ projectId, runId: run.id });
    const ai = provider();
    const goal = context.goals[0]?.statement ?? "";
    const result = resultSchema.parse(await ai.generate(run.type, goal, JSON.stringify({ tasks: context.tasks.map(t => t.title), reports: context.reports.map(r => r.title), metrics: context.metrics })));
    const committed = await db.$transaction(async tx => {
      // A stale worker may have been reclaimed while the provider was running.
      const owned = await tx.agentRun.updateMany({ where: { id: run.id, projectId, workflowId, status: "RUNNING", startedAt }, data: { status: "COMPLETED", output: result, provider: ai.name, model: ai.model, error: null, completedAt: new Date() } });
      if (owned.count === 0) return false;
      const writeContext = { projectId, runId: run.id, client: tx };
      for (const task of result.tasks) await tools.createTask(writeContext, task);
      for (const report of result.reports) await tools.createReport(writeContext, report);
      for (const metric of result.metrics) await tools.saveMetric(writeContext, metric);
      await tx.agentEvent.create({ data: { runId: run.id, kind: "completed", message: result.summary } });
      await tx.activityEvent.create({ data: { projectId, kind: "agent", message: `${run.type.toLowerCase()} agent: ${result.summary}` } });
      return true;
    }, { isolationLevel: "Serializable", timeout: 15_000 });
    if (!committed) return run;
  } catch (error) {
    const message = error instanceof AiProviderError || error instanceof MetricKeyConflictError ? error.message : error instanceof ZodError ? "AI provider returned an invalid structured result." : "Agent execution failed. Please retry.";
    console.error("Forge agent run failed", { runId: run.id, reason: message });
    const failed = await db.agentRun.updateMany({ where: { id: run.id, projectId, workflowId, status: "RUNNING", startedAt }, data: { status: "FAILED", error: message, completedAt: new Date() } });
    if (failed.count) {
      await db.agentEvent.create({ data: { runId: run.id, kind: "failed", message } });
      await db.agentRun.updateMany({ where: { workflowId, projectId, status: "PENDING" }, data: { status: "FAILED", error: "Skipped because an earlier agent failed", completedAt: new Date() } });
    }
    throw error;
  }
  return run;
}
