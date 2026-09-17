import { describe, expect, it, vi } from "vitest";
import { researchQueries, validateEvidence } from "./contracts";
import { collectResearch, researchReport } from "./runtime";
import type { ResearchProvider } from "./provider";

const excerpt = "A published survey describes how small teams struggle to manage customer requests and need faster response times.";
const analysis = { summary: "The retrieved page suggests a customer support workflow problem.", limitations: "One page is insufficient to estimate overall market demand.", findings: [{ area: "CUSTOMER_PAIN" as const, claim: "Small teams report difficulty managing customer requests.", sourceIndex: 0, quote: "small teams struggle to manage customer requests", confidence: "LOW" as const, limitation: "This is one source and its sample is not representative." }] };

describe("bounded evidence-backed research", () => {
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

  it("caps unique page retrievals at six even when searches return more hits", async () => {
    let next = 0;
    const provider: ResearchProvider = { name: "fake-search", search: vi.fn(async () => Array.from({ length: 3 }, () => ({ title: "Page", url: `https://example.org/${next++}`, snippet: "" }))), retrieve: vi.fn(async url => ({ url, title: "Page", excerpt, retrievedAt: new Date() })) };
    await collectResearch("Build a customer support product", provider, async () => analysis);
    expect(provider.search).toHaveBeenCalledTimes(5);
    expect(provider.retrieve).toHaveBeenCalledTimes(6);
  });
});
