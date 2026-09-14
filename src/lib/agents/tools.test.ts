import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ task: vi.fn(), report: vi.fn(), metric: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { task: { upsert: mocks.task }, report: { upsert: mocks.report }, metric: { upsert: mocks.metric } } }));
import { tools } from "./tools";

const ctx = { projectId: "project-id", runId: "run-id" };
beforeEach(() => vi.clearAllMocks());

describe("agent write tools", () => {
  it("keys task and report writes to the run so retries update instead of duplicate", async () => {
    await tools.createTask(ctx, { title: "Interview users", description: "Talk to five people" });
    await tools.createReport(ctx, { title: "Research", kind: "market", content: "Unverified hypothesis" });
    expect(mocks.task).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceRunId_title: { sourceRunId: "run-id", title: "Interview users" } } }));
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceRunId_title: { sourceRunId: "run-id", title: "Research" } } }));
  });
  it("rejects invalid metrics before database access", async () => {
    await expect(tools.saveMetric(ctx, { key: "INVALID KEY", label: "Invalid", value: 1, unit: "" })).rejects.toThrow();
    expect(mocks.metric).not.toHaveBeenCalled();
  });
});
