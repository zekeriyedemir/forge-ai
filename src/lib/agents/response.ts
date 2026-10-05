export class ProviderResponseError extends Error {
  constructor(readonly code: "TOO_LARGE" | "UNREADABLE") {
    super(code === "TOO_LARGE" ? "Provider response exceeded its size limit." : "Provider response could not be read.");
    this.name = "ProviderResponseError";
  }
}

// Bound the transport body before JSON.parse; a content field limit alone does not
// protect against oversized metadata, reasoning, or an error page from a provider.
export async function readProviderJson(response: Response, maxBytes = 512 * 1024): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const advertised = Number(response.headers.get("content-length"));
    if (advertised > maxBytes) throw new ProviderResponseError("TOO_LARGE");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ProviderResponseError("TOO_LARGE");
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderResponseError) throw error;
    throw new ProviderResponseError("UNREADABLE");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { return null; }
}
