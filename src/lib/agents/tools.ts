import { z } from "zod";
import { db } from "@/lib/db";

const taskSchema = z.object({ title: z.string().min(2).max(200), description: z.string().max(4000) });
const reportSchema = z.object({ title: z.string().min(2).max(200), kind: z.string().min(2).max(40), content: z.string().min(2).max(20000) });
const metricSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), label: z.string().min(2).max(80), value: z.number().finite(), unit: z.string().max(20) });
export type ToolContext = { projectId: string; runId: string };

export const tools = {
  async createTask(ctx: ToolContext, input: unknown) {
    const data = taskSchema.parse(input);
    return db.task.create({ data: { ...data, projectId: ctx.projectId, sourceRunId: ctx.runId } });
  },
  async updateTask(ctx: ToolContext, input: unknown) {
    const data = z.object({ id: z.string().uuid(), status: z.enum(["TODO", "IN_PROGRESS", "DONE"]) }).parse(input);
    return db.task.update({ where: { id: data.id, projectId: ctx.projectId }, data: { status: data.status } });
  },
  async createReport(ctx: ToolContext, input: unknown) {
    const data = reportSchema.parse(input);
    return db.report.create({ data: { ...data, projectId: ctx.projectId, sourceRunId: ctx.runId } });
  },
  async saveMetric(ctx: ToolContext, input: unknown) {
    const data = metricSchema.parse(input);
    return db.metric.upsert({ where: { projectId_key: { projectId: ctx.projectId, key: data.key } }, create: { ...data, projectId: ctx.projectId }, update: { label: data.label, value: data.value, unit: data.unit } });
  },
  async updateMetric(ctx: ToolContext, input: unknown) { return this.saveMetric(ctx, input); },
  async readProjectContext(ctx: ToolContext) {
    return db.project.findUniqueOrThrow({ where: { id: ctx.projectId }, include: { goals: { orderBy: { createdAt: "desc" }, take: 1 }, tasks: { take: 20 }, reports: { orderBy: { createdAt: "desc" }, take: 5 }, metrics: true } });
  },
  async listProjectTasks(ctx: ToolContext) { return db.task.findMany({ where: { projectId: ctx.projectId }, orderBy: { createdAt: "desc" } }); },
  async listProjectReports(ctx: ToolContext) { return db.report.findMany({ where: { projectId: ctx.projectId }, orderBy: { createdAt: "desc" } }); },
};
