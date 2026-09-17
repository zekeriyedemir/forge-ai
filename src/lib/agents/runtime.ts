import { AgentType } from "@prisma/client";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { AiProviderError, demoProvider, provider } from "./provider";
import { MetricKeyConflictError, resultSchema, type AgentResult } from "./schemas";
import { tools } from "./tools";
import { researchProviderConfigured, researchProviderFromEnv, ResearchProviderError } from "../research/provider";
import { collectResearch, researchReport, type ResearchResult } from "../research/runtime";
import { ResearchSynthesisError } from "../research/synthesis";

export const sequence: AgentType[] = ["FOUNDER", "RESEARCH", "FOUNDER", "DEVELOPER", "ANALYST"];

export async function startWorkflow(projectId: string) {
  try {
    return await db.$transaction(async tx => {
      const existing = await tx.agentRun.findFirst({ where: { projectId, status: { in: ["PENDING", "RUNNING"] } } });
      if (existing) return existing.workflowId;
      const goal = await tx.businessGoal.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
      if (!goal) throw new Error("Add a business goal before starting the workflow");
      const workflowId = crypto.randomUUID();
      for (const [step, type] of sequence.entries()) {
        const agent = await tx.agent.upsert({ where: { projectId_type: { projectId, type } }, create: { projectId, type }, update: {} });
        await tx.agentRun.create({ data: { projectId, agentId: agent.id, workflowId, step, type, input: { goal: goal.statement } } });
      }
      await tx.activityEvent.create({ data: { projectId, kind: "workflow", message: "Workflow queued" } });
      return workflowId;
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      const existing = await db.agentRun.findFirst({ where: { projectId, status: { in: ["PENDING", "RUNNING"] } } });
      if (existing) return existing.workflowId;
    }
    throw error;
  }
}

export async function advanceWorkflow(projectId: string, workflowId: string) {
  const run = await db.agentRun.findFirst({ where: { projectId, workflowId, status: { in: ["PENDING", "RUNNING"] } }, orderBy: { step: "asc" } });
  if (!run) return null;
  if (run.status === "RUNNING") {
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
    if (!run.startedAt || run.startedAt > staleBefore) return run;
    const recovered = await db.agentRun.updateMany({ where: { id: run.id, status: "RUNNING", startedAt: { lt: staleBefore } }, data: { status: "PENDING", error: "Recovered stale execution" } });
    if (recovered.count === 0) return run;
  }
  const startedAt = new Date();
  const claimed = await db.agentRun.updateMany({ where: { id: run.id, status: "PENDING" }, data: { status: "RUNNING", startedAt, error: null, completedAt: null } });
  if (claimed.count === 0) return run;
  try {
    await db.agentEvent.create({ data: { runId: run.id, kind: "started", message: `${run.type.toLowerCase()} agent started` } });
    const context = await tools.readProjectContext({ projectId, runId: run.id });
    const goal = context.goals[0]?.statement ?? "";
    const liveResearch = run.type === "RESEARCH" && process.env.DEMO_MODE !== "true";
    let research: ResearchResult | null = null;
    let providerName: string;
    let modelName: string;
    let result: AgentResult;
    if (liveResearch) {
      if (!researchProviderConfigured(process.env)) throw new ResearchProviderError("Research provider is NOT CONFIGURED. Set RESEARCH_PROVIDER=searxng with RESEARCH_SEARXNG_BASE_URL or BRAVE_SEARCH_API_KEY.");
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
    const committed = await db.$transaction(async tx => {
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
    }, { isolationLevel: "Serializable", timeout: 15_000 });
    if (!committed) return run;
  } catch (error) {
    const message = error instanceof AiProviderError || error instanceof MetricKeyConflictError || error instanceof ResearchProviderError || error instanceof ResearchSynthesisError ? error.message : error instanceof ZodError ? "AI provider returned an invalid structured result." : "Agent execution failed. Please retry.";
    console.error("Forge agent run failed", { runId: run.id, reason: message });
    const failed = await db.agentRun.updateMany({ where: { id: run.id, projectId, workflowId, status: "RUNNING", startedAt }, data: { status: "FAILED", error: message, completedAt: new Date() } });
    if (failed.count) {
      if (run.type === "RESEARCH" && process.env.DEMO_MODE !== "true") {
        const failedProvider = researchProviderConfigured(process.env) ? researchProviderFromEnv(process.env).name : "not-configured";
        await db.researchSession.upsert({ where: { runId: run.id }, create: { projectId, runId: run.id, provider: failedProvider, status: "FAILED", limitations: message, completedAt: new Date() }, update: { status: "FAILED", limitations: message, completedAt: new Date() } });
      }
      await db.agentEvent.create({ data: { runId: run.id, kind: "failed", message } });
      await db.agentRun.updateMany({ where: { workflowId, projectId, status: "PENDING" }, data: { status: "FAILED", error: "Skipped because an earlier agent failed", completedAt: new Date() } });
    }
    throw error;
  }
  return run;
}
