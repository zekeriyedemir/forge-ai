import { z } from "zod";

export const researchArea = z.enum(["MARKET", "COMPETITORS", "PRICING", "CUSTOMER_PAIN", "CUSTOMER_SEGMENTS", "DEMAND", "POSITIONING", "DISTRIBUTION", "OPPORTUNITY"]);
export const researchAnalysis = z.object({
  summary: z.string().min(20).max(1000),
  limitations: z.string().min(10).max(1000),
  findings: z.array(z.object({
    area: researchArea,
    claim: z.string().min(15).max(500),
    sourceIndex: z.number().int().min(0).max(5),
    quote: z.string().min(15).max(300),
    confidence: z.enum(["LOW", "MEDIUM"]),
    limitation: z.string().min(10).max(300),
  })).min(1).max(8),
});

export type ResearchAnalysis = z.infer<typeof researchAnalysis>;
export type ResearchEvidence = { title: string; url: string; excerpt: string; query: string; retrievedAt: Date };

function compact(value: string) { return value.replace(/\s+/g, " ").trim(); }

export function validateEvidence(analysis: ResearchAnalysis, sources: ResearchEvidence[]): ResearchAnalysis {
  const checked = researchAnalysis.parse(analysis);
  for (const finding of checked.findings) {
    const source = sources[finding.sourceIndex];
    if (!source || !compact(source.excerpt).includes(compact(finding.quote))) throw new Error("Research finding did not quote a retrieved source.");
  }
  return checked;
}

export function researchQueries(goal: string) {
  const subject = goal.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (subject.length < 10) throw new Error("A specific business goal is required for live research.");
  return [
    `${subject} market demand evidence`,
    `${subject} competitors pricing alternatives`,
    `${subject} customer pain target segments`,
    `${subject} positioning business opportunities`,
    `${subject} distribution acquisition channels`,
  ];
}
