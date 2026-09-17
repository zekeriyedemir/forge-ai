import { describe, expect, it, vi } from "vitest";
import { researchQueries, validateEvidence } from "./contracts";
import { collectResearch, researchReport, sanitizeResearchError } from "./runtime";
import type { ResearchProvider } from "./provider";

const excerpt = "A published survey describes how small teams struggle to manage customer requests and need faster response times.";
const analysis = { summary: "The retrieved page suggests a customer support workflow problem.", limitations: "One page is insufficient to estimate overall market demand.", findings: [{ area: "CUSTOMER_PAIN" as const, claim: "Small teams report difficulty managing customer requests.", sourceIndex: 0, quote: "small teams struggle to manage customer requests", confidence: "LOW" as const, limitation: "This is one source and its sample is not representative." }] };

describe("bounded evidence-backed research", () => {
  it("sanitizes nested errors without exposing URLs, credentials, or bodies", () => {
    const cause = Object.assign(new Error("socket reset https://example.org/private?token=secret"), { code: "ECONNRESET" });
    const error = Object.assign(new TypeError("request failed https://example.org/?api_key=secret response body hidden"), { code: "ERR_NETWORK", cause });
    expect(sanitizeResearchError(error)).toEqual({ constructorName: "TypeError", name: "TypeError", code: "ERR_NETWORK", message: "request failed [url redacted] response body hidden", causeName: "Error", causeCode: "ECONNRESET", causeMessage: "socket reset [url redacted]" });
  });

  it("logs only a hostname and sanitized retrieval error fields", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new TypeError("request failed https://example.org/?token=secret"), { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
    const provider: ResearchProvider = { name: "fake-search", search: vi.fn(async () => [{ title: "Survey", url: "https://example.org/article?token=secret", snippet: "Snippet" }]), retrieve: vi.fn(async () => { throw failure; }) };
    await expect(collectResearch("Build a customer support product", provider, async () => analysis)).rejects.toThrow("connection reset (ECONNRESET)");
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][1]).toEqual({ hostname: "example.org", error: sanitizeResearchError(failure) });
    expect(JSON.stringify(log.mock.calls[0])).not.toContain("secret");
    log.mockRestore();
  });

  it("uses five bounded queries, deduplicates pages, and produces cited report text", async () => {
    const provider: ResearchProvider = { name: "fake-search", search: vi.fn(async () => [{ title: "Survey", url: "https://example.org/survey", snippet: "Snippet" }]), retrieve: vi.fn(async url => ({ url, title: "Survey", excerpt, retrievedAt: new Date("2026-09-17T12:00:00Z") })) };
    const analyze = vi.fn(async () => analysis);
    const result = await collectResearch("Build a customer support product", provider, analyze);
    expect(provider.search).toHaveBeenCalledTimes(5);
    expect(provider.retrieve).toHaveBeenCalledOnce();
    expect(analyze).toHaveBeenCalledWith("Build a customer support product", result.sources);
    expect(result.sources).toHaveLength(1);
    expect(researchReport(result)).toContain("https://example.org/survey");
    expect(researchReport(result)).toContain("retrieved 2026-09-17T12:00:00.000Z");
  });

  it("rejects invented or wrong-source quotations", () => {
    const source = { title: "Survey", url: "https://example.org/survey", excerpt, query: "query", retrievedAt: new Date() };
    expect(() => validateEvidence({ ...analysis, findings: [{ ...analysis.findings[0], quote: "a made-up source quotation" }] }, [source])).toThrow("did not quote");
    expect(() => validateEvidence({ ...analysis, findings: [{ ...analysis.findings[0], sourceIndex: 1 }] }, [source])).toThrow("did not quote");
    expect(() => validateEvidence({ ...analysis, findings: [{ ...analysis.findings[0], quote: "Small teams struggle to manage customer requests" }] }, [source])).toThrow("did not quote");
  });

  it("keeps query count bounded and rejects goals too vague to research", () => {
    expect(researchQueries("Build a customer support product")).toHaveLength(5);
    expect(researchQueries("Build a customer support product").every(query => query.length <= 220)).toBe(true);
    expect(() => researchQueries("hello")).toThrow("specific business goal");
  });

  it("creates no finding if all page retrievals fail", async () => {
    const provider: ResearchProvider = { name: "fake-search", search: vi.fn(async () => [{ title: "Survey", url: "https://example.org/survey", snippet: "Snippet" }]), retrieve: vi.fn(async () => { throw new Error("page failed"); }) };
    const analyze = vi.fn(async () => analysis);
    await expect(collectResearch("Build a customer support product", provider, analyze)).rejects.toThrow("no retrievable public HTML");
    await expect(collectResearch("Build a customer support product", provider, analyze)).rejects.toThrow("1 other");
    expect(analyze).not.toHaveBeenCalled();
  });

  it.each([
    ["ECONNRESET", "connection reset (ECONNRESET)"],
    ["ECONNREFUSED", "connection unavailable (ECONNREFUSED)"],
    ["EHOSTUNREACH", "connection unavailable (EHOSTUNREACH)"],
    ["ENETUNREACH", "connection unavailable (ENETUNREACH)"],
    ["ENOTFOUND", "DNS failure (ENOTFOUND)"],
    ["EAI_AGAIN", "DNS failure (EAI_AGAIN)"],
    ["CERT_HAS_EXPIRED", "TLS/certificate (CERT_HAS_EXPIRED)"],
    ["ERR_INVALID_IP_ADDRESS", "lookup/address configuration (ERR_INVALID_IP_ADDRESS)"],
  ])("summarizes safe network failure code %s", async (code, category) => {
    const failure = Object.assign(new Error("raw URL https://example.org/?token=secret and body must stay hidden"), { code });
    const provider: ResearchProvider = { name: "fake-search", search: vi.fn(async query => [{ title: "Survey", url: `https://example.org/${encodeURIComponent(query)}`, snippet: "Snippet" }]), retrieve: vi.fn(async () => { throw failure; }) };
    await expect(collectResearch("Build a customer support product", provider, async () => analysis)).rejects.toThrow(category);
    await expect(collectResearch("Build a customer support product", provider, async () => analysis)).rejects.not.toThrow("secret");
  });

  it("classifies a network code nested in AggregateError", async () => {
    const failure = new AggregateError([Object.assign(new Error("socket reset"), { code: "ECONNRESET" })], "all retrieval attempts failed");
    const provider: ResearchProvider = { name: "fake-search", search: vi.fn(async query => [{ title: "Survey", url: `https://example.org/${encodeURIComponent(query)}`, snippet: "Snippet" }]), retrieve: vi.fn(async () => { throw failure; }) };
    await expect(collectResearch("Build a customer support product", provider, async () => analysis)).rejects.toThrow("connection reset (ECONNRESET)");
  });

  it.each([
    ["socket hang up", "socket closed"],
    ["premature close", "socket closed"],
    ["response was aborted", "aborted stream"],
    ["Compressed research pages are unsupported", "content encoding"],
  ])("summarizes safe stream failure %s", async (message, category) => {
    const provider: ResearchProvider = { name: "fake-search", search: vi.fn(async query => [{ title: "Survey", url: `https://example.org/${encodeURIComponent(query)}`, snippet: "Snippet" }]), retrieve: vi.fn(async () => { throw new Error(message); }) };
    await expect(collectResearch("Build a customer support product", provider, async () => analysis)).rejects.toThrow(category);
  });

  it("caps unique page retrievals at six even when searches return more hits", async () => {
    let next = 0;
    const provider: ResearchProvider = { name: "fake-search", search: vi.fn(async () => Array.from({ length: 3 }, () => ({ title: "Page", url: `https://example.org/${next++}`, snippet: "" }))), retrieve: vi.fn(async url => ({ url, title: "Page", excerpt, retrievedAt: new Date() })) };
    await collectResearch("Build a customer support product", provider, async () => analysis);
    expect(provider.search).toHaveBeenCalledTimes(5);
    expect(provider.retrieve).toHaveBeenCalledTimes(6);
  });
});
