import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRun: vi.fn(), createRun: vi.fn(), updateMany: vi.fn(), updateRun: vi.fn(),
  findGoal: vi.fn(), upsertAgent: vi.fn(), createEvent: vi.fn(), createActivity: vi.fn(),
  readContext: vi.fn(), createTask: vi.fn(), createReport: vi.fn(), saveMetric: vi.fn(), generate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {
  agentRun: { findFirst: mocks.findRun, create: mocks.createRun, updateMany: mocks.updateMany, update: mocks.updateRun },
  businessGoal: { findFirst: mocks.findGoal }, agent: { upsert: mocks.upsertAgent },
  agentEvent: { create: mocks.createEvent }, activityEvent: { create: mocks.createActivity },
} }));
vi.mock("./tools", () => ({ tools: { readProjectContext: mocks.readContext, createTask: mocks.createTask, createReport: mocks.createReport, saveMetric: mocks.saveMetric } }));
vi.mock("./provider", () => ({ provider: () => ({ name: "mock", model: "test", generate: mocks.generate }) }));

import { advanceWorkflow, startWorkflow } from "./runtime";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findRun.mockResolvedValue(null);
  mocks.findGoal.mockResolvedValue({ statement: "Build a useful service" });
  mocks.upsertAgent.mockResolvedValue({ id: "agent-id" });
});

describe("workflow persistence", () => {
  it("creates ordered runs for one workflow and reuses an active workflow", async () => {
    const workflowId = await startWorkflow("project-id");
    expect(mocks.createRun).toHaveBeenCalledTimes(5);
    expect(mocks.createRun.mock.calls.map(call => call[0].data.type)).toEqual(["FOUNDER", "RESEARCH", "FOUNDER", "DEVELOPER", "ANALYST"]);
    expect(mocks.createRun.mock.calls.every(call => call[0].data.workflowId === workflowId)).toBe(true);
    mocks.findRun.mockResolvedValueOnce({ workflowId });
    expect(await startWorkflow("project-id")).toBe(workflowId);
    expect(mocks.createRun).toHaveBeenCalledTimes(5);
  });

  it("claims a run once and persists output through scoped tools", async () => {
    mocks.findRun.mockResolvedValue({ id: "run-id", type: "RESEARCH", status: "PENDING" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.readContext.mockResolvedValue({ goals: [{ statement: "Build a useful service" }], tasks: [], reports: [], metrics: [] });
    mocks.generate.mockResolvedValue({ summary: "Research outline ready", tasks: [{ title: "Interview users", description: "Ask about workflows" }], reports: [{ title: "Outline", kind: "research", content: "Unverified hypothesis" }], metrics: [{ key: "interviews", label: "Interviews", value: 0, unit: "" }] });
    await advanceWorkflow("project-id", "workflow-id");
    expect(mocks.createTask).toHaveBeenCalledOnce();
    expect(mocks.createReport).toHaveBeenCalledOnce();
    expect(mocks.saveMetric).toHaveBeenCalledOnce();
    expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", provider: "mock" }) }));
  });
  it("reclaims stale executions before generating again", async () => {
    mocks.findRun.mockResolvedValue({ id: "run-id", type: "ANALYST", status: "RUNNING", startedAt: new Date(Date.now() - 5 * 60 * 1000) });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    mocks.readContext.mockResolvedValue({ goals: [{ statement: "Build a useful service" }], tasks: [], reports: [], metrics: [] });
    mocks.generate.mockResolvedValue({ summary: "Reviewed", tasks: [], reports: [], metrics: [] });
    await advanceWorkflow("project-id", "workflow-id");
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.generate).toHaveBeenCalledOnce();
  });
});
