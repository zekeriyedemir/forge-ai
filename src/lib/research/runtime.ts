import { researchQueries, validateEvidence, type ResearchAnalysis, type ResearchEvidence } from "./contracts";
import { ResearchProviderError, type ResearchProvider } from "./provider";
import { synthesizeResearch } from "./synthesis";

export type ResearchResult = { analysis: ResearchAnalysis; sources: ResearchEvidence[]; queryCount: number; provider: string; partialFailures: number };

export async function collectResearch(goal: string, search: ResearchProvider, analyze = synthesizeResearch): Promise<ResearchResult> {
  const queries = researchQueries(goal);
  const searches = await Promise.allSettled(queries.map(query => search.search(query)));
  const candidates = new Map<string, { title: string; url: string; query: string }>();
  let partialFailures = searches.filter(result => result.status === "rejected").length;
  for (let rank = 0; rank < 2; rank++) {
    searches.forEach((result, index) => {
      if (result.status !== "fulfilled" || candidates.size >= 6) return;
      const hit = result.value[rank];
      if (hit && !candidates.has(hit.url)) candidates.set(hit.url, { title: hit.title, url: hit.url, query: queries[index] });
    });
  }
  if (!candidates.size) {
    const failure = searches.find(result => result.status === "rejected");
    if (failure?.status === "rejected" && failure.reason instanceof ResearchProviderError) throw failure.reason;
    throw new ResearchProviderError("Research search returned no safe public results.");
  }
  const pages = await Promise.allSettled([...candidates.values()].map(async candidate => ({ ...await search.retrieve(candidate.url), query: candidate.query })));
  partialFailures += pages.filter(result => result.status === "rejected").length;
  const uniquePages = new Map<string, ResearchEvidence>();
  for (const result of pages) if (result.status === "fulfilled" && !uniquePages.has(result.value.url)) uniquePages.set(result.value.url, result.value);
  const sources = [...uniquePages.values()];
  if (!sources.length) throw new ResearchProviderError("Research found no retrievable public HTML pages. No findings were created.");
  const analysis = validateEvidence(await analyze(goal, sources), sources);
  return { analysis, sources, queryCount: queries.length, provider: search.name, partialFailures };
}

export function researchReport(result: ResearchResult): string {
  const lines = [result.analysis.summary, "", "Evidence-backed findings:"];
  for (const finding of result.analysis.findings) {
    const source = result.sources[finding.sourceIndex];
    lines.push(`- ${finding.area}: ${finding.claim} [${finding.sourceIndex + 1}] (${finding.confidence.toLowerCase()} confidence)`, `  Evidence: “${finding.quote}”`, `  Limitation: ${finding.limitation}`);
    if (!source) throw new Error("Research report has an invalid source index.");
  }
  lines.push("", "Sources:");
  result.sources.forEach((source, index) => lines.push(`[${index + 1}] ${source.title} — ${source.url} (retrieved ${source.retrievedAt.toISOString()})`));
  lines.push("", `Limitations: ${result.analysis.limitations}${result.partialFailures ? ` ${result.partialFailures} search/page request(s) failed.` : ""}`);
  const report = lines.join("\n");
  if (report.length > 20_000) throw new ResearchProviderError("Research report exceeded its size limit. No partial report was saved.");
  return report;
}
