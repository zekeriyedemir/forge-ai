import { researchQueries, validateEvidence, type ResearchAnalysis, type ResearchEvidence } from "./contracts";
import { ResearchProviderError, type ResearchProvider } from "./provider";
import { synthesizeResearch } from "./synthesis";

export type ResearchResult = { analysis: ResearchAnalysis; sources: ResearchEvidence[]; queryCount: number; provider: string; partialFailures: number };

export type SanitizedResearchError = {
  constructorName: string;
  name: string;
  code: string;
  message: string;
  causeName: string;
  causeCode: string;
  causeMessage: string;
};

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

function errorField(error: unknown, field: string): unknown {
  return error && typeof error === "object" ? Reflect.get(error, field) : undefined;
}

function safeErrorCode(value: unknown): string {
  return typeof value === "string" && SAFE_ERROR_CODE.test(value) ? value : "";
}

function safeErrorMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, "[url redacted]").replace(/\b(token|key|secret|password|authorization|credential)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 160);
}

export function sanitizeResearchError(error: unknown): SanitizedResearchError {
  const cause = errorField(error, "cause");
  const constructorName = error && typeof error === "object" && error.constructor && typeof error.constructor.name === "string" ? error.constructor.name : "Unknown";
  return {
    constructorName,
    name: typeof errorField(error, "name") === "string" ? String(errorField(error, "name")) : "",
    code: safeErrorCode(errorField(error, "code")),
    message: safeErrorMessage(errorField(error, "message")),
    causeName: typeof errorField(cause, "name") === "string" ? String(errorField(cause, "name")) : "",
    causeCode: safeErrorCode(errorField(cause, "code")),
    causeMessage: safeErrorMessage(errorField(cause, "message")),
  };
}

function safeHostname(value: string): string {
  try { return new URL(value).hostname.toLowerCase(); }
  catch { return "invalid-host"; }
}

function errorSignals(error: unknown): string {
  const details = sanitizeResearchError(error);
  const aggregateErrors = errorField(error, "errors");
  const aggregateSignals = Array.isArray(aggregateErrors) ? aggregateErrors.slice(0, 3).map(item => {
    const nested = sanitizeResearchError(item);
    return `${nested.code} ${nested.message}`;
  }).join(" ") : "";
  return `${details.code} ${details.causeCode} ${details.message} ${details.causeMessage} ${aggregateSignals}`.toLowerCase();
}

function retrievalFailureCategory(error: unknown): string {
  const details = sanitizeResearchError(error);
  const aggregateErrors = errorField(error, "errors");
  const aggregateCodes = Array.isArray(aggregateErrors) ? aggregateErrors.map(item => sanitizeResearchError(item).code) : [];
  const codes = [details.code, details.causeCode, ...aggregateCodes];
  const message = errorSignals(error);
  const resetCode = codes.find(item => item === "ECONNRESET");
  const unavailableCode = codes.find(item => ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(item));
  const dnsCode = codes.find(item => ["ENOTFOUND", "EAI_AGAIN"].includes(item));
  const tlsCode = codes.find(item => item.startsWith("CERT_") || item.startsWith("ERR_TLS") || ["DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(item));
  if (resetCode) return `connection reset (${resetCode})`;
  if (unavailableCode) return `connection unavailable (${unavailableCode})`;
  if (dnsCode) return `DNS failure (${dnsCode})`;
  if (tlsCode) return `TLS/certificate (${tlsCode})`;
  if (message.includes("content-encoding") || message.includes("compressed")) return "content encoding";
  if (message.includes("socket hang up") || message.includes("premature close")) return "socket closed";
  if (message.includes("aborted") || message.includes("destroyed")) return "aborted stream";
  if (message.includes("timed out") || message.includes("timeout")) return "timeout";
  if (message.includes("not html") || message.includes("unavailable")) return "non-html/unavailable";
  if (message.includes("public addresses") || message.includes("permitted public")) return "network policy";
  if (message.includes("redirect")) return "redirect";
  if (message.includes("readable text")) return "insufficient text";
  if (message.includes("size limit") || message.includes("exceeded")) return "size limit";
  return "other";
}

function retrievalFailureSummary(results: PromiseSettledResult<unknown>[]): string {
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result.status !== "rejected") continue;
    const category = retrievalFailureCategory(result.reason);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => `${count} ${category}`).join(", ");
}

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
  const candidateList = [...candidates.values()];
  pages.forEach((result, index) => {
    if (result.status === "rejected") console.error("Forge research page retrieval failed", { hostname: safeHostname(candidateList[index].url), error: sanitizeResearchError(result.reason) });
  });
  const uniquePages = new Map<string, ResearchEvidence>();
  for (const result of pages) if (result.status === "fulfilled" && !uniquePages.has(result.value.url)) uniquePages.set(result.value.url, result.value);
  const sources = [...uniquePages.values()];
  if (!sources.length) {
    const summary = retrievalFailureSummary(pages);
    throw new ResearchProviderError(`Research found no retrievable public HTML pages. No findings were created.${summary ? ` Retrieval failures: ${summary}.` : ""}`);
  }
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
