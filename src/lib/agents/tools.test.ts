import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ task: vi.fn(), report: vi.fn(), metric: vi.fn(), findMetric: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { task: { upsert: mocks.task }, report: { upsert: mocks.report }, metric: { upsert: mocks.metric, findUnique: mocks.findMetric } } }));
import { tools } from "./tools";

const ctx = { projectId: "project-id", runId: "run-id" };
beforeEach(() => { vi.clearAllMocks(); mocks.findMetric.mockResolvedValue(null); });

describe("agent write tools", () => {
  it("keys task and report writes to the run so retries update instead of duplicate", async () => {
    await tools.createTask(ctx, { title: "Interview users", description: "Talk to five people" });
    await tools.createReport(ctx, { title: "Research", kind: "market", content: "Unverified hypothesis" });
    expect(mocks.task).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceRunId_title: { sourceRunId: "run-id", title: "Interview users" } } }));
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceRunId_title: { sourceRunId: "run-id", title: "Research" } } }));
  });
  it("rejects invalid metrics before database access", async () => {
    await expect(tools.saveMetric(ctx, { key: "../secret", label: "Invalid", value: 1, unit: "" })).rejects.toThrow();
    expect(mocks.metric).not.toHaveBeenCalled();
  });

  it("normalizes readable metric names into stable keys before upserting", async () => {
    await tools.saveMetric(ctx, { key: "Monthly Active Users", label: "Monthly active users", value: 10, unit: "" });
    await tools.saveMetric(ctx, { key: "monthly-active-users", label: "Monthly active users", value: 11, unit: "" });
    expect(mocks.metric).toHaveBeenCalledTimes(2);
    for (const call of mocks.metric.mock.calls) expect(call[0].where).toEqual({ projectId_key: { projectId: "project-id", key: "monthly_active_users" } });
  });

  it("rejects a normalized key that would overwrite another metric's label or unit", async () => {
    mocks.findMetric.mockResolvedValue({ label: "Net revenue", unit: "EUR" });
    await expect(tools.saveMetric(ctx, { key: "revenue", label: "Gross revenue", value: 50, unit: "EUR" })).rejects.toThrow("different label or unit");
    expect(mocks.metric).not.toHaveBeenCalled();
  });

  it("updates only the value when the metric identity matches", async () => {
    mocks.findMetric.mockResolvedValue({ label: "Monthly active users", unit: "" });
    await tools.saveMetric(ctx, { key: "Monthly Active Users", label: "monthly active users", value: 12, unit: "" });
    expect(mocks.metric).toHaveBeenCalledWith(expect.objectContaining({ update: { value: 12 } }));
  });
});
