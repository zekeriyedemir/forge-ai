import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";

const SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_SEARCH_BYTES = 96 * 1024;
const MAX_PAGE_BYTES = 64 * 1024;
const MAX_EXCERPT = 12_000;
const searchResponse = z.object({ web: z.object({ results: z.array(z.object({ title: z.string(), url: z.string(), description: z.string().nullish() })) }).optional() });

export type SearchHit = { title: string; url: string; snippet: string };
export type RetrievedPage = { url: string; title: string; excerpt: string; retrievedAt: Date };
export interface ResearchProvider {
  name: string;
  search(query: string): Promise<SearchHit[]>;
  retrieve(url: string): Promise<RetrievedPage>;
}
export class ResearchProviderError extends Error {}

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

async function pinnedPage(url: URL, address: string): Promise<{ status: number; contentType: string; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const call = request(url, { method: "GET", timeout: 5_000, signal: AbortSignal.timeout(5_000), headers: { Accept: "text/html", "Accept-Encoding": "identity", "User-Agent": "ForgeResearch/1.0" }, lookup: (_hostname, _options, callback) => callback(null, address, 4) }, response => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers["content-type"] ?? "");
      const location = typeof response.headers.location === "string" ? response.headers.location : undefined;
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { response.destroy(); reject(new ResearchProviderError("Compressed research pages are unsupported.")); return; }
      if (Number(response.headers["content-length"] ?? 0) > MAX_PAGE_BYTES) { response.destroy(); reject(new ResearchProviderError("Research page exceeded its size limit.")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_PAGE_BYTES) { response.destroy(); reject(new ResearchProviderError("Research page exceeded its size limit.")); } else chunks.push(chunk); });
      response.on("end", () => resolve({ status, contentType, location, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
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

export function braveResearchProvider(apiKey: string): ResearchProvider {
  if (!apiKey.trim()) throw new ResearchProviderError("Research provider is NOT CONFIGURED.");
  return {
    name: "brave-search",
    async search(query) {
      const url = new URL(SEARCH_ENDPOINT);
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
      const payload = searchResponse.safeParse(json);
      if (!payload.success) throw new ResearchProviderError("Research provider returned an invalid search result.");
      return (payload.data.web?.results ?? []).slice(0, 3).flatMap(hit => {
        try { return [{ title: hit.title.slice(0, 200), url: publicResearchUrl(hit.url).href, snippet: (hit.description ?? "").slice(0, 600) }]; }
        catch { return []; }
      });
    },
    retrieve: retrievePublicPage,
  };
}
