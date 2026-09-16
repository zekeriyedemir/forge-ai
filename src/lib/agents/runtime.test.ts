import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRun: vi.fn(), createRun: vi.fn(), updateMany: vi.fn(), transaction: vi.fn(),
  findGoal: vi.fn(), upsertAgent: vi.fn(), createEvent: vi.fn(), createActivity: vi.fn(),
  readContext: vi.fn(), createTask: vi.fn(), createReport: vi.fn(), saveMetric: vi.fn(), generate: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    agentRun: { findFirst: mocks.findRun, create: mocks.createRun, updateMany: mocks.updateMany },
    businessGoal: { findFirst: mocks.findGoal }, agent: { upsert: mocks.upsertAgent },
    agentEvent: { create: mocks.createEvent }, activityEvent: { create: mocks.createActivity },
  };
  return { db: { ...tx, $transaction: mocks.transaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) => work(tx)) } };
});
vi.mock("./tools", () => ({ tools: { readProjectContext: mocks.readContext, createTask: mocks.createTask, createReport: mocks.createReport, saveMetric: mocks.saveMetric } }));
vi.mock("./provider", () => ({ AiProviderError: class AiProviderError extends Error {}, provider: () => ({ name: "mock", model: "test", generate: mocks.generate }) }));

import { AiProviderError } from "./provider";
import { advanceWorkflow, startWorkflow } from "./runtime";

const projectId = "project-id";
const workflowId = "workflow-id";
const pendingRun = { id: "run-id", type: "RESEARCH" as const, status: "PENDING" as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.findRun.mockResolvedValue(null);
  mocks.findGoal.mockResolvedValue({ statement: "Build a useful service" });
  mocks.upsertAgent.mockResolvedValue({ id: "agent-id" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.readContext.mockResolvedValue({ goals: [{ statement: "Build a useful service" }], tasks: [], reports: [], metrics: [] });
  mocks.generate.mockResolvedValue({ summary: "Ready", tasks: [], reports: [], metrics: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("workflow persistence", () => {
  it("creates ordered runs, reuses an active workflow, and allows a new one after failure", async () => {
    const firstWorkflow = await startWorkflow(projectId);
    expect(mocks.createRun).toHaveBeenCalledTimes(5);
    expect(mocks.createRun.mock.calls.map(call => call[0].data.type)).toEqual(["FOUNDER", "RESEARCH", "FOUNDER", "DEVELOPER", "ANALYST"]);
    expect(mocks.createRun.mock.calls.every(call => call[0].data.workflowId === firstWorkflow)).toBe(true);
    mocks.findRun.mockResolvedValueOnce({ workflowId: firstWorkflow });
    expect(await startWorkflow(projectId)).toBe(firstWorkflow);
    expect(mocks.createRun).toHaveBeenCalledTimes(5);
    expect(await startWorkflow(projectId)).not.toBe(firstWorkflow);
    expect(mocks.createRun).toHaveBeenCalledTimes(10);
  });

  it("does not record a queued workflow when run creation fails", async () => {
    mocks.createRun.mockRejectedValueOnce(new Error("Database write failed"));
    await expect(startWorkflow(projectId)).rejects.toThrow("Database write failed");
    expect(mocks.createActivity).not.toHaveBeenCalled();
  });

  it("validates first, then writes output and completion in one transaction", async () => {
    mocks.findRun.mockResolvedValue(pendingRun);
    mocks.generate.mockResolvedValue({ summary: "Research outline ready", tasks: [{ title: "Interview users", description: "Ask about workflows" }], reports: [{ title: "Outline", kind: "research", content: "Unverified hypothesis" }], metrics: [{ key: "Discovery Interviews", label: "Discovery interviews", value: 0, unit: "" }] });
    await advanceWorkflow(projectId, workflowId);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.createTask).toHaveBeenCalledOnce();
    expect(mocks.createReport).toHaveBeenCalledOnce();
    expect(mocks.saveMetric).toHaveBeenCalledWith(expect.objectContaining({ client: expect.any(Object) }), expect.objectContaining({ key: "discovery_interviews" }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", provider: "mock" }) }));
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "completed" }) }));
  });

  it("persists a failed run and skips later steps without writing invalid model output", async () => {
    mocks.findRun.mockResolvedValue(pendingRun);
    mocks.generate.mockResolvedValue({ summary: "Bad output", tasks: [{ title: "x", description: "" }], reports: [], metrics: [] });
    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createReport).not.toHaveBeenCalled();
    expect(mocks.saveMetric).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: "AI provider returned an invalid structured result." }) }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workflowId, projectId, status: "PENDING" }, data: expect.objectContaining({ status: "FAILED" }) }));
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "failed" }) }));
  });

  it("persists a safe provider error without exposing raw model output", async () => {
    mocks.findRun.mockResolvedValue(pendingRun);
    mocks.generate.mockRejectedValue(new AiProviderError("AI provider returned an invalid structured result after one retry."));
    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow("invalid structured result");
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: "AI provider returned an invalid structured result after one retry." }) }));
    expect(console.error).toHaveBeenCalledWith("Forge agent run failed", { runId: "run-id", reason: "AI provider returned an invalid structured result after one retry." });
  });

  it("reclaims stale executions but ignores a worker that lost its claim", async () => {
    const staleRun = { id: "run-id", type: "ANALYST" as const, status: "RUNNING" as const, startedAt: new Date(Date.now() - 5 * 60 * 1000) };
    mocks.findRun.mockResolvedValue(staleRun);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await advanceWorkflow(projectId, workflowId);
    expect(mocks.updateMany).toHaveBeenCalledTimes(3);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createEvent).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "completed" }) }));
  });

  it("does not generate twice when another worker already claimed the run", async () => {
    mocks.findRun.mockResolvedValue(pendingRun);
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await advanceWorkflow(projectId, workflowId);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
