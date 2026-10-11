import { AgentType, Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import { AiProviderError, demoProvider, provider } from "./provider";
import { MetricKeyConflictError, resultSchema, type AgentResult } from "./schemas";
import { tools } from "./tools";
import { assertResearchAvailable, researchProviderConfigured, researchProviderFromEnv, ResearchProviderError } from "../research/provider";
import { collectResearch, researchReport, type ResearchResult } from "../research/runtime";
import { ResearchSynthesisError } from "../research/synthesis";
import { SKIPPED_ERROR, workflowFailure, type WorkflowFailureCode } from "./workflow-status";

export const sequence: AgentType[] = ["FOUNDER", "RESEARCH", "FOUNDER", "DEVELOPER", "ANALYST"];
const runInput = z.object({ goal: z.string().trim().min(10).max(2000) });
export class WorkflowLimitError extends Error {
  constructor() { super("Workflow limit reached. Try again later."); }
}
export class WorkflowPreflightError extends Error {
  readonly code: WorkflowFailureCode;
  constructor(code: unknown) {
    const failure = workflowFailure(code);
    super(failure.message);
    this.code = failure.code;
  }
}

async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 }); }
    catch (error) {
      if (attempt >= 2 || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error;
    }
  }
}

function failureDetails(error: unknown) {
  if (error instanceof ResearchProviderError) return workflowFailure(error.code ?? "RESEARCH_PROVIDER");
  if (error instanceof ResearchSynthesisError) return workflowFailure(error.code ?? "RESEARCH_SYNTHESIS");
  if (error instanceof AiProviderError) return workflowFailure(error.code ?? "AI_PROVIDER");
  if (error instanceof MetricKeyConflictError) return workflowFailure("METRIC_CONFLICT");
  return workflowFailure(error instanceof ZodError ? "INVALID_RESULT" : "EXECUTION_FAILED");
}

export async function startWorkflow(projectId: string) {
    if (process.env.DEMO_MODE !== "true") {
      // Resume active work without repeating a search probe. Recheck inside the
      // transaction below so concurrent starts still create only one workflow.
      const existing = await db.agentRun.findFirst({ where: { projectId, status: { in: ["PENDING", "RUNNING"] } } });
      if (existing) return existing.workflowId;
      const goal = await db.businessGoal.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
      if (!goal) throw new Error("Add a business goal before starting the workflow");
      const recent = await db.agentRun.count({ where: { projectId, type: "FOUNDER", step: 0, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
      if (recent >= 5) throw new WorkflowLimitError();
      try { provider(); }
      catch { throw new WorkflowPreflightError("AI_NOT_CONFIGURED"); }
      // No provider requests inside the database transaction and no AI call or
      // failed history records when the search dependency is unavailable.
      try { await assertResearchAvailable(); }
      catch (error) { throw new WorkflowPreflightError(failureDetails(error).code); }
    }
    return serializable(async tx => {
      const existing = await tx.agentRun.findFirst({ where: { projectId, status: { in: ["PENDING", "RUNNING"] } } });
      if (existing) return existing.workflowId;
      const recent = await tx.agentRun.count({ where: { projectId, type: "FOUNDER", step: 0, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
      if (recent >= 5) throw new WorkflowLimitError();
      const goal = await tx.businessGoal.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
      if (!goal) throw new Error("Add a business goal before starting the workflow");
      const workflowId = crypto.randomUUID();
      for (const [step, type] of sequence.entries()) {
        const agent = await tx.agent.upsert({ where: { projectId_type: { projectId, type } }, create: { projectId, type }, update: {} });
        await tx.agentRun.create({ data: { projectId, agentId: agent.id, workflowId, step, type, input: { goal: goal.statement } } });
      }
      await tx.activityEvent.create({ data: { projectId, kind: "workflow", message: "Workflow queued" } });
      return workflowId;
    });
}

export async function advanceWorkflow(projectId: string, workflowId: string) {
  const run = await db.agentRun.findFirst({ where: { projectId, workflowId, status: { in: ["PENDING", "RUNNING"] } }, orderBy: { step: "asc" } });
  if (!run) return null;
  if (run.status === "RUNNING") {
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
    if (run.startedAt && run.startedAt > staleBefore) return run;
    const recovered = await db.agentRun.updateMany({ where: { id: run.id, status: "RUNNING", startedAt: run.startedAt ? { lte: staleBefore } : null }, data: { status: "PENDING", error: "Recovered stale execution" } });
    if (recovered.count === 0) return run;
  }
  const startedAt = new Date();
  const claimed = await db.agentRun.updateMany({ where: { id: run.id, status: "PENDING" }, data: { status: "RUNNING", startedAt, error: null, completedAt: null } });
  if (claimed.count === 0) return run;
  try {
    await db.agentEvent.create({ data: { runId: run.id, kind: "started", message: `${run.type.toLowerCase()} agent started` } });
    const context = await tools.readProjectContext({ projectId, runId: run.id });
    const input = runInput.safeParse(run.input);
    // All steps use the goal captured when this workflow was queued, even if the
    // project goal is edited while an earlier provider request is in flight.
    const goal = input.success ? input.data.goal : context.goals[0]?.statement ?? "";
    const liveResearch = run.type === "RESEARCH" && process.env.DEMO_MODE !== "true";
    let research: ResearchResult | null = null;
    let providerName: string;
    let modelName: string;
    let result: AgentResult;
    if (liveResearch) {
      if (!researchProviderConfigured(process.env)) throw new ResearchProviderError("Research provider is NOT CONFIGURED. Set RESEARCH_PROVIDER=searxng with RESEARCH_SEARXNG_BASE_URL or BRAVE_SEARCH_API_KEY.", "RESEARCH_NOT_CONFIGURED");
      if (!process.env.OPENAI_API_KEY?.trim()) throw new ResearchSynthesisError("AI provider is NOT CONFIGURED for research synthesis.");
      const selected = researchProviderFromEnv(process.env);
      research = await collectResearch(goal, selected);
      result = resultSchema.parse({ summary: research.analysis.summary, tasks: [], reports: [{ title: "Evidence-backed market research", kind: "research", content: researchReport(research) }], metrics: [] });
      providerName = `${research.provider}+openai-compatible`;
      modelName = process.env.OPENAI_MODEL ?? "openai-compatible";
    } else {
      const ai = run.type === "RESEARCH" && process.env.DEMO_MODE === "true" ? demoProvider() : provider();
      let verifiedResearch: { area: string; claim: string; quote: string; url: string; limitation: string }[] = [];
      if (run.type === "FOUNDER" && run.step > 0) {
        const session = await db.researchSession.findFirst({ where: { projectId, run: { workflowId }, status: "COMPLETED" }, include: { findings: { include: { source: true }, take: 8 } } });
        verifiedResearch = session?.findings.map(finding => ({ area: finding.area, claim: finding.claim, quote: finding.quote, url: finding.source.url, limitation: finding.limitation })) ?? [];
      }
      result = resultSchema.parse(await ai.generate(run.type, goal, JSON.stringify({ tasks: context.tasks.map(t => t.title), reports: context.reports.map(r => r.title), metrics: context.metrics, verifiedResearch })));
      providerName = ai.name;
      modelName = ai.model;
    }
    const committed = await serializable(async tx => {
      // A stale worker may have been reclaimed while the provider was running.
      const owned = await tx.agentRun.updateMany({ where: { id: run.id, projectId, workflowId, status: "RUNNING", startedAt }, data: { status: "COMPLETED", output: result, provider: providerName, model: modelName, error: null, completedAt: new Date() } });
      if (owned.count === 0) return false;
      if (research) {
        const session = await tx.researchSession.create({ data: { projectId, runId: run.id, provider: research.provider, status: "COMPLETED", summary: research.analysis.summary, limitations: research.analysis.limitations, queryCount: research.queryCount, startedAt, completedAt: new Date() } });
        const sourceIds: string[] = [];
        for (const source of research.sources) {
          const saved = await tx.researchSource.create({ data: { sessionId: session.id, url: source.url, title: source.title, query: source.query, excerpt: source.excerpt, retrievedAt: source.retrievedAt } });
          sourceIds.push(saved.id);
        }
        for (const finding of research.analysis.findings) await tx.researchFinding.create({ data: { sessionId: session.id, sourceId: sourceIds[finding.sourceIndex], area: finding.area, claim: finding.claim, quote: finding.quote, confidence: finding.confidence, limitation: finding.limitation } });
      }
      const writeContext = { projectId, runId: run.id, client: tx };
      for (const task of result.tasks) await tools.createTask(writeContext, task);
      for (const report of result.reports) await tools.createReport(writeContext, report);
      for (const metric of result.metrics) await tools.saveMetric(writeContext, metric);
      await tx.agentEvent.create({ data: { runId: run.id, kind: "completed", message: result.summary } });
      await tx.activityEvent.create({ data: { projectId, kind: "agent", message: `${run.type.toLowerCase()} agent: ${result.summary}` } });
      return true;
    });
    if (!committed) return run;
  } catch (error) {
    const { message, code } = failureDetails(error);
    console.error("Forge agent run failed", { projectId, workflowId, runId: run.id, code });
    // Cancellation and failure details are one write boundary. A diagnostic write
    // must never leave later agents runnable after a failed prerequisite.
    await serializable(async tx => {
      const failed = await tx.agentRun.updateMany({ where: { id: run.id, projectId, workflowId, status: "RUNNING", startedAt }, data: { status: "FAILED", error: message, completedAt: new Date() } });
      if (!failed.count) return;
      if (run.type === "RESEARCH" && process.env.DEMO_MODE !== "true") {
        let failedProvider = "not-configured";
        try { if (researchProviderConfigured(process.env)) failedProvider = researchProviderFromEnv(process.env).name; } catch { /* Invalid configuration is itself a reportable failure. */ }
        await tx.researchSession.upsert({ where: { runId: run.id }, create: { projectId, runId: run.id, provider: failedProvider, status: "FAILED", limitations: message, completedAt: new Date() }, update: { status: "FAILED", limitations: message, completedAt: new Date() } });
      }
      await tx.agentEvent.create({ data: { runId: run.id, kind: "failed", message, data: { code } } });
      await tx.agentRun.updateMany({ where: { workflowId, projectId, status: "PENDING" }, data: { status: "FAILED", error: SKIPPED_ERROR, completedAt: new Date() } });
    });
    throw error;
  }
  return run;
}
