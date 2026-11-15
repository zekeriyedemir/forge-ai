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

const researchStopWords = new Set(["a", "am", "an", "and", "are", "as", "at", "be", "but", "build", "building", "can", "could", "color", "colors", "control", "create", "creating", "customer", "customers", "do", "does", "each", "even", "everything", "feature", "features", "fit", "for", "from", "he", "her", "his", "how", "i", "im", "in", "into", "is", "it", "its", "make", "making", "mostly", "of", "on", "online", "or", "order", "orders", "pay", "place", "platform", "she", "site", "that", "the", "they", "this", "to", "wait", "want", "wants", "we", "website", "what", "with", "would", "you", "your"]);

export function researchKeywords(goal: string) {
  const subject = goal.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (subject.length < 10) throw new Error("A specific business goal is required for live research.");
  const words = subject.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const seen = new Set<string>();
  const keywords = words.reverse().filter(word => {
    if (researchStopWords.has(word) || seen.has(word)) return false;
    seen.add(word);
    return true;
  }).reverse();
  return keywords.slice(-6);
}

export function researchQueries(goal: string) {
  const subject = goal.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const researchSubject = (researchKeywords(subject).join(" ") || subject).slice(0, 120);
  return [
    `${researchSubject} market demand evidence`,
    `${researchSubject} competitors pricing alternatives`,
    `${researchSubject} customer pain target segments`,
    `${researchSubject} positioning business opportunities`,
    `${researchSubject} distribution acquisition channels`,
  ];
}
