import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { MetricKeyConflictError, metricSchema, reportSchema, taskSchema } from "./schemas";

export type ToolContext = { projectId: string; runId: string; client?: Prisma.TransactionClient };

export const tools = {
  async createTask(ctx: ToolContext, input: unknown) {
    const data = taskSchema.parse(input);
    const client = ctx.client ?? db;
    return client.task.upsert({ where: { sourceRunId_title: { sourceRunId: ctx.runId, title: data.title } }, create: { ...data, projectId: ctx.projectId, sourceRunId: ctx.runId }, update: { description: data.description } });
  },
  async updateTask(ctx: ToolContext, input: unknown) {
    const data = z.object({ id: z.string().uuid(), status: z.enum(["TODO", "IN_PROGRESS", "DONE"]) }).parse(input);
    const client = ctx.client ?? db;
    return client.task.update({ where: { id: data.id, projectId: ctx.projectId }, data: { status: data.status } });
  },
  async createReport(ctx: ToolContext, input: unknown) {
    const data = reportSchema.parse(input);
    const client = ctx.client ?? db;
    return client.report.upsert({ where: { sourceRunId_title: { sourceRunId: ctx.runId, title: data.title } }, create: { ...data, projectId: ctx.projectId, sourceRunId: ctx.runId }, update: { kind: data.kind, content: data.content } });
  },
  async saveMetric(ctx: ToolContext, input: unknown) {
    const data = metricSchema.parse(input);
    const client = ctx.client ?? db;
    const where = { projectId_key: { projectId: ctx.projectId, key: data.key } };
    const existing = await client.metric.findUnique({ where, select: { label: true, unit: true } });
    if (existing && (existing.label.trim().toLowerCase() !== data.label.trim().toLowerCase() || existing.unit !== data.unit)) {
      throw new MetricKeyConflictError("Metric key already belongs to a different label or unit.");
    }
    return client.metric.upsert({ where, create: { ...data, projectId: ctx.projectId }, update: { value: data.value } });
  },
  async updateMetric(ctx: ToolContext, input: unknown) { return this.saveMetric(ctx, input); },
  async readProjectContext(ctx: ToolContext) {
    return db.project.findUniqueOrThrow({ where: { id: ctx.projectId }, include: { goals: { orderBy: { createdAt: "desc" }, take: 1 }, tasks: { take: 20 }, reports: { orderBy: { createdAt: "desc" }, take: 5 }, metrics: true } });
  },
  async listProjectTasks(ctx: ToolContext) { return db.task.findMany({ where: { projectId: ctx.projectId }, orderBy: { createdAt: "desc" } }); },
  async listProjectReports(ctx: ToolContext) { return db.report.findMany({ where: { projectId: ctx.projectId }, orderBy: { createdAt: "desc" } }); },
};
