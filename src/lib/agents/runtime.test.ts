import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRun: vi.fn(), createRun: vi.fn(), updateMany: vi.fn(), transaction: vi.fn(),
  findGoal: vi.fn(), upsertAgent: vi.fn(), createEvent: vi.fn(), createActivity: vi.fn(),
  readContext: vi.fn(), createTask: vi.fn(), createReport: vi.fn(), saveMetric: vi.fn(), generate: vi.fn(),
  collectResearch: vi.fn(), researchReport: vi.fn(), createSession: vi.fn(), createSource: vi.fn(), createFinding: vi.fn(), upsertSession: vi.fn(), findSession: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    agentRun: { findFirst: mocks.findRun, create: mocks.createRun, updateMany: mocks.updateMany },
    businessGoal: { findFirst: mocks.findGoal }, agent: { upsert: mocks.upsertAgent },
    agentEvent: { create: mocks.createEvent }, activityEvent: { create: mocks.createActivity },
    researchSession: { create: mocks.createSession, upsert: mocks.upsertSession, findFirst: mocks.findSession },
    researchSource: { create: mocks.createSource }, researchFinding: { create: mocks.createFinding },
  };
  return { db: { ...tx, $transaction: mocks.transaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) => work(tx)) } };
});
vi.mock("./tools", () => ({ tools: { readProjectContext: mocks.readContext, createTask: mocks.createTask, createReport: mocks.createReport, saveMetric: mocks.saveMetric } }));
vi.mock("./provider", () => ({ AiProviderError: class AiProviderError extends Error {}, provider: () => ({ name: "mock", model: "test", generate: mocks.generate }), demoProvider: () => ({ name: "mock", model: "test", generate: mocks.generate }) }));
vi.mock("../research/provider", () => ({
  ResearchProviderError: class ResearchProviderError extends Error {},
  researchProviderConfigured: (env: Record<string, string | undefined> = process.env) => Boolean(env.BRAVE_SEARCH_API_KEY?.trim() || env.RESEARCH_SEARXNG_BASE_URL?.trim()),
  researchProviderFromEnv: (env: Record<string, string | undefined> = process.env) => ({ name: env.BRAVE_SEARCH_API_KEY?.trim() ? "brave-search" : "searxng" }),
  braveResearchProvider: () => ({ name: "mock-search" }),
}));
vi.mock("../research/runtime", () => ({ collectResearch: mocks.collectResearch, researchReport: mocks.researchReport }));

import { AiProviderError } from "./provider";
import { advanceWorkflow, startWorkflow } from "./runtime";

const projectId = "project-id";
const workflowId = "workflow-id";
const pendingRun = { id: "run-id", type: "RESEARCH" as const, status: "PENDING" as const };

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "true");
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.findRun.mockResolvedValue(null);
  mocks.findGoal.mockResolvedValue({ statement: "Build a useful service" });
  mocks.upsertAgent.mockResolvedValue({ id: "agent-id" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.readContext.mockResolvedValue({ goals: [{ statement: "Build a useful service" }], tasks: [], reports: [], metrics: [] });
  mocks.generate.mockResolvedValue({ summary: "Ready", tasks: [], reports: [], metrics: [] });
  mocks.createSession.mockResolvedValue({ id: "session-id" });
  mocks.createSource.mockResolvedValue({ id: "source-id" });
  mocks.researchReport.mockReturnValue("Evidence-backed report [1]");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

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

  it("persists retrieved research and exact-source findings atomically, then makes them available to Founder", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-only-key");
    vi.stubEnv("OPENAI_API_KEY", "test-only-ai-key");
    mocks.findRun.mockResolvedValue({ ...pendingRun, step: 1 });
    mocks.collectResearch.mockResolvedValue({ provider: "mock-search", queryCount: 5, partialFailures: 0, sources: [{ title: "Public page", url: "https://example.org/page", query: "market", excerpt: "A long published source excerpt about customer demand.", retrievedAt: new Date() }], analysis: { summary: "One source indicates a possible customer need.", limitations: "Only one public page was sampled.", findings: [{ area: "DEMAND", claim: "The page describes a possible customer need.", sourceIndex: 0, quote: "published source excerpt about customer demand", confidence: "LOW", limitation: "One page cannot establish market-wide demand." }] } });
    await advanceWorkflow(projectId, workflowId);
    expect(mocks.collectResearch).toHaveBeenCalledOnce();
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", runId: "run-id" }) }));
    expect(mocks.createSource).toHaveBeenCalledOnce();
    expect(mocks.createFinding).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceId: "source-id", area: "DEMAND" }) }));
    expect(mocks.createReport).toHaveBeenCalledOnce();
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.findRun.mockResolvedValue({ id: "founder-run", type: "FOUNDER", step: 2, status: "PENDING" });
    mocks.findSession.mockResolvedValue({ findings: [{ area: "DEMAND", claim: "Possible need", quote: "exact source quote", limitation: "One page", source: { url: "https://example.org/page" } }] });
    await advanceWorkflow(projectId, workflowId);
    expect(JSON.parse(mocks.generate.mock.calls[0][2]).verifiedResearch).toEqual([{ area: "DEMAND", claim: "Possible need", quote: "exact source quote", url: "https://example.org/page", limitation: "One page" }]);
  });

  it("fails live research visibly when the search provider is not configured", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    mocks.findRun.mockResolvedValue({ ...pendingRun, step: 1 });
    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow("NOT CONFIGURED");
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.upsertSession).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("checks AI configuration before spending a search request", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-only-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    mocks.findRun.mockResolvedValue({ ...pendingRun, step: 1 });
    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow("AI provider is NOT CONFIGURED");
    expect(mocks.collectResearch).not.toHaveBeenCalled();
  });

  it("does not persist research evidence after losing the run claim", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-only-key");
    vi.stubEnv("OPENAI_API_KEY", "test-only-ai-key");
    mocks.findRun.mockResolvedValue({ ...pendingRun, step: 1 });
    mocks.collectResearch.mockResolvedValue({ provider: "mock-search", queryCount: 5, partialFailures: 0, sources: [{ title: "Page", url: "https://example.org/page", query: "market", excerpt: "A public page with enough relevant words to support a finding.", retrievedAt: new Date() }], analysis: { summary: "The retrieved page suggests an opportunity.", limitations: "Only one page was sampled.", findings: [] } });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await advanceWorkflow(projectId, workflowId);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.createSource).not.toHaveBeenCalled();
    expect(mocks.createReport).not.toHaveBeenCalled();
  });
});
