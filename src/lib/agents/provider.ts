import { z } from "zod";
import { serverEnv } from "@/lib/env";

export const resultSchema = z.object({
  summary: z.string(),
  tasks: z.array(z.object({ title: z.string(), description: z.string() })).max(8),
  reports: z.array(z.object({ title: z.string(), kind: z.string(), content: z.string() })).max(4),
  metrics: z.array(z.object({ key: z.string(), label: z.string(), value: z.number(), unit: z.string() })).max(6),
});
export type AgentResult = z.infer<typeof resultSchema>;
export type AgentKind = "FOUNDER" | "RESEARCH" | "DEVELOPER" | "ANALYST";

export interface AiProvider {
  name: string;
  model: string;
  generate(kind: AgentKind, goal: string, context: string): Promise<AgentResult>;
}

const mock: AiProvider = {
  name: "mock",
  model: "deterministic-demo",
  async generate(kind, goal) {
    const subject = goal.replace(/[.!?]+$/, "");
    const byKind: Record<AgentKind, AgentResult> = {
      FOUNDER: { summary: `Demo strategy for: ${subject}. Validate a narrow customer problem before building.`, tasks: [{ title: "Interview five prospective customers", description: "Record the problem, current workaround, and willingness to pay." }, { title: "Define the MVP success criterion", description: "Choose one measurable activation event and a target date." }], reports: [{ title: "Initial strategy", kind: "strategy", content: `Goal: ${goal}\n\nHypothesis: a focused product can serve an identifiable niche.\n\nMilestones: discovery, prototype, pilot, launch. These are demo suggestions, not verified market facts.` }], metrics: [{ key: "discovery_interviews", label: "Discovery interviews", value: 0, unit: "" }] },
      RESEARCH: { summary: "Demo research outline created. Market claims require independent verification.", tasks: [{ title: "Verify three competitor offerings", description: "Compare pricing, target customer, and differentiators using primary sources." }], reports: [{ title: "Market research outline", kind: "research", content: `Goal: ${goal}\n\nCustomer profile hypothesis: small teams with a repeated, costly workflow.\n\nCompetitor research checklist: direct alternatives, indirect alternatives, pricing, positioning.\n\nOpportunity: interview customers before making market-size claims. Demo content; no live web research was performed.` }], metrics: [] },
      DEVELOPER: { summary: "Demo technical plan prepared.", tasks: [{ title: "Build a clickable prototype", description: "Implement the core user journey and instrument activation." }, { title: "Run a pilot with three users", description: "Collect qualitative feedback and fix the largest friction points." }], reports: [{ title: "MVP architecture", kind: "technical", content: `Goal: ${goal}\n\nBuild one end-to-end workflow with authentication, persistent data, and observable events.\n\nSequence: prototype → pilot → measure → iterate. Avoid adding integrations until a customer needs them. Demo recommendation.` }], metrics: [] },
      ANALYST: { summary: "Demo progress review completed.", tasks: [{ title: "Review pilot evidence", description: "Compare actual activation and retention with the success criterion." }], reports: [{ title: "Progress and risks", kind: "analysis", content: "Current risk: no verified customer demand or revenue data. Track interviews, activation, retention, and paid conversions. Next action: complete discovery tasks and review evidence." }], metrics: [{ key: "validated_customers", label: "Validated customers", value: 0, unit: "" }] },
    };
    return byKind[kind];
  },
};

export function provider(): AiProvider {
  const env = serverEnv();
  if (!env.OPENAI_API_KEY) return mock;
  return {
    name: "openai-compatible",
    model: env.OPENAI_MODEL,
    async generate(kind, goal, context) {
      const response = await fetch(`${env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.OPENAI_MODEL, response_format: { type: "json_object" }, messages: [
          { role: "system", content: `You are the ${kind.toLowerCase()} agent. Return JSON with summary, tasks [{title,description}], reports [{title,kind,content}], metrics [{key,label,value,unit}]. Use evidence-aware language. Never claim research you did not perform. Keep output concise.` },
          { role: "user", content: `Business goal: ${goal}\nProject context: ${context}` },
        ] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return resultSchema.parse(JSON.parse(data.choices?.[0]?.message?.content ?? "{}"));
    },
  };
}
