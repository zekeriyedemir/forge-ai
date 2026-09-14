import { AgentType } from "@prisma/client";
import { db } from "@/lib/db";
import { provider } from "./provider";
import { tools } from "./tools";

export const sequence: AgentType[] = ["FOUNDER", "RESEARCH", "FOUNDER", "DEVELOPER", "ANALYST"];

export async function startWorkflow(projectId: string) {
  const existing = await db.agentRun.findFirst({ where: { projectId, status: { in: ["PENDING", "RUNNING"] } } });
  if (existing) return existing.workflowId;
  const goal = await db.businessGoal.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
  if (!goal) throw new Error("Add a business goal before starting the workflow");
  const workflowId = crypto.randomUUID();
  for (const [step, type] of sequence.entries()) {
    const agent = await db.agent.upsert({ where: { projectId_type: { projectId, type } }, create: { projectId, type }, update: {} });
    await db.agentRun.create({ data: { projectId, agentId: agent.id, workflowId, step, type, input: { goal: goal.statement } } });
  }
  await db.activityEvent.create({ data: { projectId, kind: "workflow", message: "Workflow queued" } });
  return workflowId;
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
  const claimed = await db.agentRun.updateMany({ where: { id: run.id, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date() } });
  if (claimed.count === 0) return run;
  await db.agentEvent.create({ data: { runId: run.id, kind: "started", message: `${run.type.toLowerCase()} agent started` } });
  try {
    const context = await tools.readProjectContext({ projectId, runId: run.id });
    const ai = provider();
    const goal = context.goals[0]?.statement ?? "";
    const result = await ai.generate(run.type, goal, JSON.stringify({ tasks: context.tasks.map(t => t.title), reports: context.reports.map(r => r.title), metrics: context.metrics }));
    for (const task of result.tasks) await tools.createTask({ projectId, runId: run.id }, task);
    for (const report of result.reports) await tools.createReport({ projectId, runId: run.id }, report);
    for (const metric of result.metrics) await tools.saveMetric({ projectId, runId: run.id }, metric);
    await db.agentRun.update({ where: { id: run.id }, data: { status: "COMPLETED", output: result, provider: ai.name, model: ai.model, completedAt: new Date() } });
    await db.agentEvent.create({ data: { runId: run.id, kind: "completed", message: result.summary } });
    await db.activityEvent.create({ data: { projectId, kind: "agent", message: `${run.type.toLowerCase()} agent: ${result.summary}` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent error";
    await db.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", error: message, completedAt: new Date() } });
    await db.agentEvent.create({ data: { runId: run.id, kind: "failed", message } });
    await db.agentRun.updateMany({ where: { workflowId, projectId, status: "PENDING" }, data: { status: "FAILED", error: "Skipped because an earlier agent failed", completedAt: new Date() } });
    throw error;
  }
  return run;
}
