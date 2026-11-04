import { describe, expect, it, vi } from "vitest";
import { readProviderJson } from "./response";

describe("bounded provider response parsing", () => {
  it("limits streamed bytes, cancels oversized bodies, and does not trust content-length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(33))); }, cancel });
    await expect(readProviderJson(new Response(stream, { headers: { "content-length": "1" } }), 32)).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not buffer advertised oversized responses", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    await expect(readProviderJson(new Response(stream, { headers: { "content-length": "1000" } }), 32)).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps arbitrary body-read errors out of diagnostics", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private provider details")); } });
    await expect(readProviderJson(new Response(stream))).rejects.toMatchObject({ code: "UNREADABLE", message: "Provider response could not be read." });
  });

  it("classifies malformed JSON and parses UTF-8 across chunks", async () => {
    await expect(readProviderJson(new Response("<html>upstream error</html>"))).rejects.toMatchObject({ code: "INVALID_JSON" });
    const bytes = new TextEncoder().encode('{"text":"Grüße"}');
    const stream = new ReadableStream<Uint8Array>({ start(controller) { bytes.forEach(byte => controller.enqueue(new Uint8Array([byte]))); controller.close(); } });
    expect(await readProviderJson(new Response(stream))).toEqual({ text: "Grüße" });
  });
});
