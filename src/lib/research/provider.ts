import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_SEARCH_BYTES = 96 * 1024;
const MAX_PAGE_BYTES = 64 * 1024;
const MAX_EXCERPT = 12_000;
const braveSearchResponse = z.object({ web: z.object({ results: z.array(z.object({ title: z.string(), url: z.string(), description: z.string().nullish() })) }).optional() });
const searxngSearchResponse = z.object({ results: z.array(z.object({ title: z.string().nullish(), url: z.string().nullish(), content: z.string().nullish(), snippet: z.string().nullish(), description: z.string().nullish() })).default([]) });

export type SearchHit = { title: string; url: string; snippet: string };
export type RetrievedPage = { url: string; title: string; excerpt: string; retrievedAt: Date };
export interface ResearchProvider {
  name: string;
  search(query: string): Promise<SearchHit[]>;
  retrieve(url: string): Promise<RetrievedPage>;
}
export type ResearchProviderKind = "auto" | "searxng" | "brave";
export class ResearchProviderError extends Error {}

export function researchProviderConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const provider = (env.RESEARCH_PROVIDER ?? "auto").trim().toLowerCase() as ResearchProviderKind;
  if (provider === "brave") return Boolean(env.BRAVE_SEARCH_API_KEY?.trim());
  if (provider === "searxng") return Boolean(env.RESEARCH_SEARXNG_BASE_URL?.trim());
  return Boolean(env.RESEARCH_SEARXNG_BASE_URL?.trim() || env.BRAVE_SEARCH_API_KEY?.trim());
}

export function researchProviderFromEnv(env: Record<string, string | undefined> = process.env): ResearchProvider {
  const provider = (env.RESEARCH_PROVIDER ?? "auto").trim().toLowerCase() as ResearchProviderKind;
  const selected = provider === "auto" ? (env.RESEARCH_SEARXNG_BASE_URL?.trim() ? "searxng" : env.BRAVE_SEARCH_API_KEY?.trim() ? "brave" : "none") : provider;
  if (selected === "searxng") {
    const base = env.RESEARCH_SEARXNG_BASE_URL?.trim();
    if (!base) throw new ResearchProviderError("Research provider is NOT CONFIGURED. Set RESEARCH_PROVIDER=searxng and RESEARCH_SEARXNG_BASE_URL for local research.");
    return searxngResearchProvider(base);
  }
  if (selected === "brave") {
    const apiKey = env.BRAVE_SEARCH_API_KEY?.trim();
    if (!apiKey) throw new ResearchProviderError("Research provider is NOT CONFIGURED. Set BRAVE_SEARCH_API_KEY for Brave search.");
    return braveResearchProvider(apiKey);
  }
  throw new ResearchProviderError("Research provider is NOT CONFIGURED. Set RESEARCH_PROVIDER=searxng with RESEARCH_SEARXNG_BASE_URL or provide BRAVE_SEARCH_API_KEY.");
}

export function publicResearchUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ResearchProviderError("Research result URL is invalid."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || isIP(host) || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || /(^|\.)(localhost|local|internal|test|invalid|example|onion|lan)$/.test(host) || host.includes("..")) throw new ResearchProviderError("Research result URL is not a permitted public HTTPS address.");
  url.hostname = host;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/token|key|secret|signature|credential|password|authorization/i.test(key)) throw new ResearchProviderError("Research result URL contains a credential-like parameter.");
    if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  }
  if (url.href.length > 512) throw new ResearchProviderError("Research result URL exceeded its size limit.");
  return url;
}

export function publicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && c === 0 || b === 88 && c === 99 || b === 0 && c === 2) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113 || a === 168 && b === 63 && c === 129 && address.endsWith(".16"));
}

export function extractHtmlText(html: string): { title: string; excerpt: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "Untitled page";
  const focus = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[2] ?? html;
  const plain = focus.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  const decode = (value: string) => value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ", "&#39;": "'" })[entity.toLowerCase()] ?? " ").replace(/\s+/g, " ").trim();
  return { title: decode(title).slice(0, 200), excerpt: decode(plain).slice(0, MAX_EXCERPT) };
}

async function boundedBody(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ResearchProviderError("Research provider response was empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ResearchProviderError("Research provider response exceeded its size limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function boundedHtmlBody(stream: AsyncIterable<Uint8Array>, stop: () => void = () => {}): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const remaining = MAX_PAGE_BYTES - size;
    if (remaining <= 0) break;
    chunks.push(chunk.subarray(0, remaining));
    size += Math.min(chunk.byteLength, remaining);
    if (size >= MAX_PAGE_BYTES) {
      stop();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function pinnedPage(url: URL, address: string): Promise<{ status: number; contentType: string; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const call = request(url, { method: "GET", timeout: 5_000, signal: AbortSignal.timeout(5_000), headers: { Accept: "text/html", "Accept-Encoding": "identity", "User-Agent": "ForgeResearch/1.0" }, lookup: (_hostname, _options, callback) => callback(null, address, 4) }, response => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers["content-type"] ?? "");
      const location = typeof response.headers.location === "string" ? response.headers.location : undefined;
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { response.destroy(); reject(new ResearchProviderError("Compressed research pages are unsupported.")); return; }
      if (status >= 200 && status < 300 && !/^text\/html(?:;|$)/i.test(contentType)) { response.destroy(); reject(new ResearchProviderError("Research page was unavailable or not HTML.")); return; }
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve({ status, contentType, location, body: responseBody });
      };
      let responseBody = "";
      boundedHtmlBody(response, () => { response.pause(); response.destroy(); }).then(body => { responseBody = body; finish(); }).catch(error => finish(error));
    });
    call.on("timeout", () => call.destroy(new ResearchProviderError("Research page request timed out.")));
    call.on("error", reject);
    call.end();
  });
}

async function limitedDns<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ResearchProviderError("Research DNS lookup timed out.")), 3_000); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function retrievePublicPage(value: string, io: { resolve: typeof lookup; fetch: typeof pinnedPage } = { resolve: lookup, fetch: pinnedPage }): Promise<RetrievedPage> {
  let url = publicResearchUrl(value);
  for (let redirects = 0; redirects <= 2; redirects++) {
    const addresses = await limitedDns(io.resolve(url.hostname, { family: 4, all: true }).catch(() => []));
    if (!addresses.length || addresses.some(item => !publicIpv4(item.address))) throw new ResearchProviderError("Research page did not resolve only to public addresses.");
    const response = await io.fetch(url, addresses[0].address);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirects === 2) throw new ResearchProviderError("Research page redirected too many times.");
      url = publicResearchUrl(new URL(response.location, url).href);
      continue;
    }
    if (response.status !== 200 || !/^text\/html(?:;|$)/i.test(response.contentType)) throw new ResearchProviderError("Research page was unavailable or not HTML.");
    const extracted = extractHtmlText(response.body);
    if (extracted.excerpt.length < 80) throw new ResearchProviderError("Research page did not contain enough readable text.");
    return { url: url.href, ...extracted, retrievedAt: new Date() };
  }
  throw new ResearchProviderError("Research page could not be retrieved.");
}

function normalizeSearxngEndpoint(value: string): URL {
  const base = new URL(value.trim());
  if (!/^https?:$/i.test(base.protocol)) throw new ResearchProviderError("Research provider URL must use HTTPS.");
  const candidate = new URL(base.toString());
  if (/\/search$/i.test(candidate.pathname)) return candidate;
  candidate.pathname = `${candidate.pathname.replace(/\/+$/, "")}/search`;
  return candidate;
}

export function searxngResearchProvider(baseUrl: string): ResearchProvider {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new ResearchProviderError("Research provider is NOT CONFIGURED.");
  const endpoint = normalizeSearxngEndpoint(trimmed);
  return {
    name: "searxng",
    async search(query) {
      const url = new URL(endpoint.toString());
      url.searchParams.set("q", query.slice(0, 220));
      url.searchParams.set("format", "json");
      url.searchParams.set("count", "3");
      url.searchParams.set("language", "en");
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "ForgeResearch/1.0" }, signal: AbortSignal.timeout(8_000), cache: "no-store", redirect: "error" }).catch(() => { throw new ResearchProviderError("Research search request timed out, redirected, or could not connect."); });
      if (response.status === 401 || response.status === 403) throw new ResearchProviderError("Research provider rejected its credentials or access.");
      if (response.status === 429) throw new ResearchProviderError("Research provider rate limit reached.");
      if (!response.ok) throw new ResearchProviderError(`Research search request failed (${response.status}).`);
      let json: unknown;
      const body = await boundedBody(response, MAX_SEARCH_BYTES);
      try { json = JSON.parse(body); }
      catch { throw new ResearchProviderError("Research provider returned malformed search JSON."); }
      const payload = searxngSearchResponse.safeParse(json);
      if (!payload.success) throw new ResearchProviderError("Research provider returned an invalid search result.");
      return payload.data.results.slice(0, 3).flatMap(hit => {
        const safeUrl = hit.url?.trim();
        const snippetSource = hit.content ?? hit.snippet ?? hit.description ?? "";
        if (!safeUrl) return [];
        try { return [{ title: (hit.title ?? "Untitled result").slice(0, 200), url: publicResearchUrl(safeUrl).href, snippet: snippetSource.slice(0, 600) }]; }
        catch { return []; }
      });
    },
    retrieve: retrievePublicPage,
  };
}

export function braveResearchProvider(apiKey: string): ResearchProvider {
  if (!apiKey.trim()) throw new ResearchProviderError("Research provider is NOT CONFIGURED.");
  return {
    name: "brave-search",
    async search(query) {
      const url = new URL(BRAVE_SEARCH_ENDPOINT);
      url.searchParams.set("q", query.slice(0, 220));
      url.searchParams.set("count", "3");
      const response = await fetch(url, { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(8_000), cache: "no-store", redirect: "error" }).catch(() => { throw new ResearchProviderError("Research search request timed out, redirected, or could not connect."); });
      if (response.status === 401 || response.status === 403) throw new ResearchProviderError("Research provider rejected its credentials.");
      if (response.status === 429) throw new ResearchProviderError("Research provider rate limit reached.");
      if (!response.ok) throw new ResearchProviderError(`Research search request failed (${response.status}).`);
      let json: unknown;
      const body = await boundedBody(response, MAX_SEARCH_BYTES);
      try { json = JSON.parse(body); }
      catch { throw new ResearchProviderError("Research provider returned malformed search JSON."); }
      const payload = braveSearchResponse.safeParse(json);
      if (!payload.success) throw new ResearchProviderError("Research provider returned an invalid search result.");
      return (payload.data.web?.results ?? []).slice(0, 3).flatMap(hit => {
        try { return [{ title: hit.title.slice(0, 200), url: publicResearchUrl(hit.url).href, snippet: (hit.description ?? "").slice(0, 600) }]; }
        catch { return []; }
      });
    },
    retrieve: retrievePublicPage,
  };
}
