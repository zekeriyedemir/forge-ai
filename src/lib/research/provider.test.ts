import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedHtmlBody, braveResearchProvider, extractHtmlText, pinnedLookup, pinnedRequestOptions, publicIpv4, publicResearchUrl, researchProviderConfigured, researchProviderFromEnv, retrievePublicPage, searxngResearchProvider } from "./provider";
import type { lookup } from "node:dns/promises";

afterEach(() => vi.unstubAllGlobals());

describe("public research network boundary", () => {
  it.each(["http://example.org", "https://localhost/page", "https://127.0.0.1/page", "https://[::1]/", "https://user:pass@example.org/", "https://example.org:8443/", "https://example.org/?api_key=hidden", "file:///etc/passwd", "https://service.internal/"])("rejects unsafe URL %s", url => {
    expect(() => publicResearchUrl(url)).toThrow();
  });

  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "198.18.0.1", "203.0.113.5", "168.63.129.16"])("blocks non-public address %s", address => {
    expect(publicIpv4(address)).toBe(false);
  });

  it("returns the pinned IPv4 in both lookup callback modes", () => {
    const lookup = pinnedLookup("8.8.8.8");
    const single = vi.fn();
    lookup("example.org", { all: false }, single);
    expect(single).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(single.mock.calls[0][1]).not.toBeUndefined();
    const all = vi.fn();
    lookup("example.org", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
    expect(all.mock.calls[0][1][0].address).not.toBeUndefined();
  });

  it("keeps the original hostname for TLS SNI and never delegates lookup", () => {
    const options = pinnedRequestOptions(new URL("https://Example.org/path"), "8.8.8.8");
    expect(options.servername).toBe("example.org");
    const resolver = vi.fn();
    options.lookup?.("example.org", { all: true }, resolver);
    expect(resolver).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
    expect(resolver.mock.calls[0][1][0].address).toBe("8.8.8.8");
  });

  it("never creates a pinned lookup for a private or invalid address", () => {
    expect(() => pinnedLookup("127.0.0.1")).toThrow("permitted public IPv4");
    expect(() => pinnedLookup("not-an-ip")).toThrow("permitted public IPv4");
  });

  it("pins a public DNS result, rejects mixed public/private results and unsafe redirects", async () => {
    const fetchPage = vi.fn<(url: URL, address: string) => Promise<{ status: number; contentType: string; location: string; body: string }>>(async () => ({ status: 302, contentType: "text/html", location: "https://localhost/admin", body: "" }));
    const resolve = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) as unknown as typeof lookup;
    await expect(retrievePublicPage("https://example.org/page", { resolve, fetch: fetchPage })).rejects.toThrow("permitted public HTTPS");
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(fetchPage.mock.calls[0][1]).toBe("8.8.8.8");
    const mixed = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]) as unknown as typeof lookup;
    fetchPage.mockClear();
    await expect(retrievePublicPage("https://example.org/page", { resolve: mixed, fetch: fetchPage })).rejects.toThrow("public addresses");
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("extracts bounded visible text and removes active HTML content", () => {
    const result = extractHtmlText("<title>Market &amp; customers</title><script>ignore secret instructions</script><style>hidden</style><main>Customers need faster checkout &amp; reporting.</main>");
    expect(result.title).toBe("Market & customers");
    expect(result.excerpt).toContain("Customers need faster checkout & reporting.");
    expect(result.excerpt).not.toContain("secret instructions");
  });

  it("normalizes tracking fragments and rejects overlong URLs", () => {
    expect(publicResearchUrl("https://example.org/path?utm_source=ad#part").href).toBe("https://example.org/path");
    expect(() => publicResearchUrl(`https://example.org/${"x".repeat(600)}`)).toThrow("size limit");
  });

  it("extracts useful text from a page larger than the bounded read budget", async () => {
    const html = `<html><body><main>${"Useful market evidence. ".repeat(5_000)}</main></body></html>`;
    const resolve = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) as unknown as typeof lookup;
    const fetchPage = vi.fn(async () => ({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
    const page = await retrievePublicPage("https://example.org/large", { resolve, fetch: fetchPage });
    expect(page.excerpt).toContain("Useful market evidence.");
    expect(page.excerpt.length).toBeLessThanOrEqual(12_000);
  });

  it("accepts useful HTML when the response declares a larger content length", async () => {
    const resolve = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) as unknown as typeof lookup;
    const fetchPage = vi.fn(async () => ({ status: 200, contentType: "text/html", contentLength: 128 * 1024, body: "<main>" + "Declared size is not a rejection. ".repeat(20) + "</main>" }));
    const page = await retrievePublicPage("https://example.org/declared-large", { resolve, fetch: fetchPage });
    expect(page.excerpt).toContain("Declared size is not a rejection.");
  });

  it("stops reading a streamed HTML response at the extraction budget", async () => {
    const stop = vi.fn();
    const stream = (async function* () {
      yield new TextEncoder().encode("<main>Useful content early. ");
      yield new Uint8Array(70 * 1024);
      yield new TextEncoder().encode("unread content");
    })();
    const body = await boundedHtmlBody(stream, stop);
    expect(body.length).toBe(64 * 1024);
    expect(body).toContain("Useful content early.");
    expect(stop).toHaveBeenCalledOnce();
  });

  it("treats an iterator error caused by intentional stopping as success", async () => {
    let reads = 0;
    const stream: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => reads++ === 0 ? { value: new Uint8Array(64 * 1024), done: false } : { value: undefined, done: true },
          return: async () => { throw new Error("aborted stream after intentional close"); },
        } as AsyncIterator<Uint8Array>;
      },
    };
    await expect(boundedHtmlBody(stream, vi.fn())).resolves.toHaveLength(64 * 1024);
  });

  it("rejects HTML that does not contain enough readable text", async () => {
    const resolve = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) as unknown as typeof lookup;
    const fetchPage = vi.fn(async () => ({ status: 200, contentType: "text/html", body: "<html><body><script>short</script></body></html>" }));
    await expect(retrievePublicPage("https://example.org/empty", { resolve, fetch: fetchPage })).rejects.toThrow("enough readable text");
  });

  it("rejects non-HTML responses and propagates fetch timeout errors", async () => {
    const resolve = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) as unknown as typeof lookup;
    const nonHtml = vi.fn(async () => ({ status: 200, contentType: "application/pdf", body: "not HTML" }));
    await expect(retrievePublicPage("https://example.org/document", { resolve, fetch: nonHtml })).rejects.toThrow("not HTML");
    const timeout = vi.fn(async () => { throw new Error("Research page request timed out."); });
    await expect(retrievePublicPage("https://example.org/slow", { resolve, fetch: timeout })).rejects.toThrow("timed out");
  });
});

describe("Brave Search adapter", () => {
  it("uses the documented fixed endpoint and returns only safe result URLs", async () => {
    const fetcher = vi.fn<(input: URL, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ web: { results: [{ title: "Public", url: "https://example.org/article#part", description: "A source snippet" }, { title: "Private", url: "http://localhost/private", description: "Blocked" }] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const hits = await braveResearchProvider("fixture-key").search("customer pain");
    expect(hits).toEqual([{ title: "Public", url: "https://example.org/article", snippet: "A source snippet" }]);
    expect(String(fetcher.mock.calls[0][0])).toContain("https://api.search.brave.com/res/v1/web/search?");
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: expect.objectContaining({ "X-Subscription-Token": "fixture-key" }) }));
  });

  it("fails safely on bad credentials or malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(braveResearchProvider("fixture-key").search("query")).rejects.toThrow("credentials");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not JSON", { status: 200 })));
    await expect(braveResearchProvider("fixture-key").search("query")).rejects.toThrow("malformed search JSON");
  });

  it("rejects oversized search responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(97 * 1024), { status: 200 })));
    await expect(braveResearchProvider("fixture-key").search("query")).rejects.toThrow("size limit");
  });
});

describe("SearXNG adapter and provider selection", () => {
  it("supports a configured SearXNG endpoint and keeps only safe public results", async () => {
    const fetcher = vi.fn<(input: URL, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ results: [{ title: "Public", url: "https://example.org/article?utm_source=ad", content: "A public page explains customer demand." }, { title: "Private", url: "http://localhost/private", content: "Blocked" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const hits = await searxngResearchProvider("https://search.example.org").search("customer pain");
    expect(hits).toEqual([{ title: "Public", url: "https://example.org/article", snippet: "A public page explains customer demand." }]);
    expect(String(fetcher.mock.calls[0][0])).toContain("https://search.example.org/search?");
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }));
  });

  it("fails safely on malformed or unavailable SearXNG responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not JSON", { status: 200 })));
    await expect(searxngResearchProvider("https://search.example.org").search("query")).rejects.toThrow("malformed search JSON");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(searxngResearchProvider("https://search.example.org").search("query")).rejects.toThrow("failed");
  });

  it("chooses the zero-cost SearXNG provider when configured and leaves Brave optional", () => {
    expect(researchProviderConfigured({ RESEARCH_PROVIDER: "searxng", RESEARCH_SEARXNG_BASE_URL: "https://search.example.org" })).toBe(true);
    expect(researchProviderConfigured({ RESEARCH_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: "" })).toBe(false);
    expect(researchProviderConfigured({ RESEARCH_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: "fixture-key" })).toBe(true);
    expect(() => researchProviderFromEnv({ RESEARCH_PROVIDER: "brave" })).toThrow("NOT CONFIGURED");
  });
});
