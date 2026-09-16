import { z } from "zod";

export class MetricKeyConflictError extends Error {}

// Accept readable ASCII names, then enforce the database/tool identifier format.
// Reject rather than truncate long or unsafe names so different metrics cannot collapse silently.
export const metricKeySchema = z.string().min(1).max(80)
  .refine(key => !/[\u0000-\u001f\u007f]/.test(key), "Metric keys cannot contain control characters")
  .transform(key => key.trim())
  .pipe(z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]*$/))
  .transform(key => key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[ -]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/_+$/g, "")
    .toLowerCase())
  .pipe(z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/));

export const taskSchema = z.object({ title: z.string().min(2).max(200), description: z.string().max(4000) });
export const reportSchema = z.object({ title: z.string().min(2).max(200), kind: z.string().min(2).max(40), content: z.string().min(2).max(20000) });
export const metricSchema = z.object({ key: metricKeySchema, label: z.string().min(2).max(80), value: z.number().finite(), unit: z.string().max(20) });

export const resultSchema = z.object({
  summary: z.string().min(1).max(2000),
  tasks: z.array(taskSchema).max(8),
  reports: z.array(reportSchema).max(4),
  metrics: z.array(metricSchema).max(6),
}).superRefine((result, context) => {
  const keys = new Set<string>();
  result.metrics.forEach((metric, index) => {
    if (keys.has(metric.key)) context.addIssue({ code: "custom", path: ["metrics", index, "key"], message: "Metric keys must be unique after normalization" });
    keys.add(metric.key);
  });
});

export type AgentResult = z.infer<typeof resultSchema>;
