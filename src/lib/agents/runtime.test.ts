import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRun: vi.fn(), countRuns: vi.fn(), createRun: vi.fn(), updateMany: vi.fn(), transaction: vi.fn(),
  findGoal: vi.fn(), upsertAgent: vi.fn(), createEvent: vi.fn(), createActivity: vi.fn(),
  readContext: vi.fn(), createTask: vi.fn(), createReport: vi.fn(), saveMetric: vi.fn(), generate: vi.fn(),
  collectResearch: vi.fn(), researchReport: vi.fn(), createSession: vi.fn(), createSource: vi.fn(), createFinding: vi.fn(), upsertSession: vi.fn(), findSession: vi.fn(),
  assertResearchAvailable: vi.fn(), createProvider: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    agentRun: { findFirst: mocks.findRun, count: mocks.countRuns, create: mocks.createRun, updateMany: mocks.updateMany },
    businessGoal: { findFirst: mocks.findGoal }, agent: { upsert: mocks.upsertAgent },
    agentEvent: { create: mocks.createEvent }, activityEvent: { create: mocks.createActivity },
    researchSession: { create: mocks.createSession, upsert: mocks.upsertSession, findFirst: mocks.findSession },
    researchSource: { create: mocks.createSource }, researchFinding: { create: mocks.createFinding },
  };
  return { db: { ...tx, $transaction: mocks.transaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) => work(tx)) } };
});
vi.mock("./tools", () => ({ tools: { readProjectContext: mocks.readContext, createTask: mocks.createTask, createReport: mocks.createReport, saveMetric: mocks.saveMetric } }));
vi.mock("./provider", () => ({ AiProviderError: class AiProviderError extends Error {}, provider: mocks.createProvider, demoProvider: () => ({ name: "mock", model: "test", generate: mocks.generate }) }));
vi.mock("../research/provider", () => ({
  ResearchProviderError: class ResearchProviderError extends Error {
    constructor(message: string, readonly code = "RESEARCH_UNAVAILABLE") { super(message); }
  },
  assertResearchAvailable: mocks.assertResearchAvailable,
  researchProviderConfigured: (env: Record<string, string | undefined> = process.env) => Boolean(env.BRAVE_SEARCH_API_KEY?.trim() || env.RESEARCH_SEARXNG_BASE_URL?.trim()),
  researchProviderFromEnv: (env: Record<string, string | undefined> = process.env) => ({ name: env.BRAVE_SEARCH_API_KEY?.trim() ? "brave-search" : "searxng" }),
  braveResearchProvider: () => ({ name: "mock-search" }),
}));
vi.mock("../research/runtime", () => ({ collectResearch: mocks.collectResearch, researchReport: mocks.researchReport }));

import { AiProviderError } from "./provider";
import { advanceWorkflow, startWorkflow, WorkflowPreflightError } from "./runtime";
import { ResearchProviderError } from "../research/provider";
import { ResearchSynthesisError } from "../research/synthesis";

const projectId = "project-id";
const workflowId = "workflow-id";
const pendingRun = { id: "run-id", type: "RESEARCH" as const, status: "PENDING" as const };

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
  vi.stubEnv("RESEARCH_SEARXNG_BASE_URL", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.clearAllMocks();
  mocks.assertResearchAvailable.mockReset().mockResolvedValue(undefined);
  mocks.createProvider.mockReset().mockReturnValue({ name: "mock", model: "test", generate: mocks.generate });
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.findRun.mockResolvedValue(null);
  mocks.countRuns.mockResolvedValue(0);
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
  it("rejects an unavailable live research service before queuing work or calling AI", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    mocks.assertResearchAvailable.mockRejectedValue(new ResearchProviderError("connect failed at https://private-key@search.invalid", "RESEARCH_UNAVAILABLE"));

    const failure = await startWorkflow(projectId).catch(error => error);

    expect(failure).toBeInstanceOf(WorkflowPreflightError);
    expect(failure).toMatchObject({ code: "RESEARCH_UNAVAILABLE" });
    expect(failure.message).toContain("npm run research:start");
    expect(failure.message).not.toContain("private-key");
    expect(mocks.assertResearchAvailable).toHaveBeenCalledOnce();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsertAgent).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.createActivity).not.toHaveBeenCalled();
  });

  it("resumes existing live work even when providers are unavailable", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    mocks.findRun.mockResolvedValue({ workflowId });
    mocks.createProvider.mockImplementation(() => { throw new Error("AI unavailable"); });
    mocks.assertResearchAvailable.mockRejectedValue(new ResearchProviderError("Search unavailable"));

    expect(await startWorkflow(projectId)).toBe(workflowId);
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.assertResearchAvailable).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("probes live search outside the write transaction before queuing ordered runs", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    mocks.assertResearchAvailable.mockImplementation(async () => {
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.createRun).not.toHaveBeenCalled();
    });

    await startWorkflow(projectId);

    expect(mocks.assertResearchAvailable).toHaveBeenCalledOnce();
    expect(mocks.createRun).toHaveBeenCalledTimes(5);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("checks AI configuration before the live search probe", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    mocks.createProvider.mockImplementation(() => { throw new Error("API key private-key is invalid"); });

    await expect(startWorkflow(projectId)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(mocks.assertResearchAvailable).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("keeps demo workflows available offline without probing live research", async () => {
    mocks.assertResearchAvailable.mockRejectedValue(new ResearchProviderError("Offline"));
    await startWorkflow(projectId);
    mocks.findRun.mockResolvedValue(pendingRun);
    await advanceWorkflow(projectId, workflowId);

    expect(mocks.createRun).toHaveBeenCalledTimes(5);
    expect(mocks.assertResearchAvailable).not.toHaveBeenCalled();
    expect(mocks.collectResearch).not.toHaveBeenCalled();
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", provider: "mock" }) }));
  });

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

  it("enforces the hourly limit within the same serializable transaction as new runs", async () => {
    mocks.countRuns.mockResolvedValue(5);
    await expect(startWorkflow(projectId)).rejects.toThrow("Workflow limit reached");
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
    expect(mocks.createRun).not.toHaveBeenCalled();
    mocks.findRun.mockResolvedValue({ workflowId });
    expect(await startWorkflow(projectId)).toBe(workflowId);
    expect(mocks.countRuns).toHaveBeenCalledOnce();
  });

  it("retries serialization conflicts and reuses the concurrently queued workflow", async () => {
    mocks.findRun.mockResolvedValueOnce(null).mockResolvedValueOnce({ workflowId });
    mocks.createRun.mockRejectedValueOnce({ code: "P2034" });
    expect(await startWorkflow(projectId)).toBe(workflowId);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
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

  it("keeps the queued workflow goal stable when the project goal changes mid-run", async () => {
    mocks.findRun.mockResolvedValue({ ...pendingRun, input: { goal: "Build the original support tool" } });
    mocks.readContext.mockResolvedValue({ goals: [{ statement: "A different new project goal" }], tasks: [], reports: [], metrics: [] });
    await advanceWorkflow(projectId, workflowId);
    expect(mocks.generate).toHaveBeenCalledWith("RESEARCH", "Build the original support tool", expect.any(String));
  });

  it("persists a failed run and skips later steps without writing invalid model output", async () => {
    mocks.findRun.mockResolvedValue(pendingRun);
    mocks.generate.mockResolvedValue({ summary: "Bad output", tasks: [{ title: "x", description: "" }], reports: [], metrics: [] });
    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createReport).not.toHaveBeenCalled();
    expect(mocks.saveMetric).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: "We couldn't complete this workflow. Please try again." }) }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workflowId, projectId, status: "PENDING" }, data: expect.objectContaining({ status: "FAILED" }) }));
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "failed" }) }));
  });

  it("persists a safe provider error without exposing raw model output", async () => {
    mocks.findRun.mockResolvedValue(pendingRun);
    mocks.generate.mockRejectedValue(new AiProviderError("AI provider returned an invalid structured result after one retry."));
    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow("invalid structured result");
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: "We couldn't get a complete response from the AI provider. Please try again or check your AI configuration." }) }));
    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "failed", data: { code: "AI_PROVIDER" } }) }));
    expect(console.error).toHaveBeenCalledWith("Forge agent run failed", { projectId, workflowId, runId: "run-id", code: "AI_PROVIDER" });
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

  it("recovers a running record whose worker never saved a start timestamp", async () => {
    mocks.findRun.mockResolvedValue({ ...pendingRun, status: "RUNNING", startedAt: null });
    await advanceWorkflow(projectId, workflowId);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: "run-id", status: "RUNNING", startedAt: null }, data: expect.objectContaining({ status: "PENDING" }) }));
    expect(mocks.generate).toHaveBeenCalledOnce();
  });

  it("does not cancel the replacement worker's steps when a stale worker fails", async () => {
    mocks.findRun.mockResolvedValue(pendingRun);
    mocks.generate.mockRejectedValue(new Error("private failure details"));
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow("private failure details");
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.createEvent).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "failed" }) }));
    expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain("private failure details");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private failure details");
  });

  it("retries failure persistence atomically after a serialization conflict", async () => {
    mocks.findRun.mockResolvedValue(pendingRun);
    mocks.generate.mockRejectedValue(new AiProviderError("Provider failed"));
    mocks.createEvent.mockResolvedValueOnce({}).mockRejectedValueOnce({ code: "P2034" });
    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow("Provider failed");
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { workflowId, projectId, status: "PENDING" }, data: expect.objectContaining({ status: "FAILED" }) }));
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

  it("distinguishes a synthesis timeout from retrieval failure", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-only-key");
    vi.stubEnv("OPENAI_API_KEY", "test-only-ai-key");
    mocks.findRun.mockResolvedValue({ ...pendingRun, step: 1 });
    mocks.collectResearch.mockRejectedValue(new ResearchSynthesisError("Research AI request timed out."));
    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow("Research AI request timed out.");
    expect(mocks.upsertSession).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: "FAILED", limitations: "We couldn't finish analyzing the research. Please try again." }) }));
    expect(mocks.upsertSession.mock.calls[0][0].create.limitations).not.toContain("retrievable public HTML");
  });

  it("persists a safe research cause code without storing private provider details", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-only-key");
    vi.stubEnv("OPENAI_API_KEY", "test-only-ai-key");
    mocks.findRun.mockResolvedValue({ ...pendingRun, step: 1 });
    mocks.collectResearch.mockRejectedValue(new ResearchProviderError("Provider denied private-key at internal-host", "RESEARCH_ACCESS_DENIED"));

    await expect(advanceWorkflow(projectId, workflowId)).rejects.toThrow("Provider denied");

    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "failed", data: { code: "RESEARCH_ACCESS_DENIED" }, message: expect.stringContaining("enable JSON") }) }));
    expect(JSON.stringify([mocks.createEvent.mock.calls, mocks.upsertSession.mock.calls, mocks.updateMany.mock.calls, vi.mocked(console.error).mock.calls])).not.toContain("private-key");
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
