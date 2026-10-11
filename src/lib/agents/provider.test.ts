import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ demoMode: "true", apiKey: "" }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ DATABASE_URL: "postgresql://localhost/forge", AUTH_SECRET: "a".repeat(32), DEMO_MODE: config.demoMode, OPENAI_API_KEY: config.apiKey, OPENAI_BASE_URL: "https://example.test/v1/", OPENAI_MODEL: "test-model" }) }));
import { AGENT_REQUEST_TIMEOUT_MS, AiProviderError, demoProvider, resultSchema, provider } from "./provider";

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });

beforeEach(() => { config.demoMode = "true"; config.apiKey = ""; vi.unstubAllGlobals(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("agent provider", () => {
  it("preserves the generic code for existing provider errors", () => {
    expect(new AiProviderError("Safe legacy message")).toMatchObject({ name: "AiProviderError", code: "AI_PROVIDER", message: "Safe legacy message" });
  });

  it("returns structured, clearly identified demo results without a key", async () => {
    const ai = provider();
    expect(ai.name).toBe("mock");
    for (const kind of ["FOUNDER", "RESEARCH", "DEVELOPER", "ANALYST"] as const) {
      const output = await ai.generate(kind, "Build a useful product", "");
      expect(resultSchema.parse(output).summary).toBeTruthy();
      expect(resultSchema.safeParse(await ai.generate(kind, "x".repeat(2000), "")).success).toBe(true);
    }
  });

  it("keeps the demo research outline mocked even if an AI key is configured", async () => {
    config.demoMode = "true";
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const demo = await demoProvider().generate("RESEARCH", "Build a useful product", "");
    expect(provider().name).toBe("mock");
    expect(demo.summary).toContain("Demo research outline");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an unconfigured non-demo deployment", () => {
    config.demoMode = "false";
    expect(() => provider()).toThrow(AiProviderError);
  });

  it("uses an OpenAI-compatible endpoint with environment credentials", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const output = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ choices: [{ message: { content: JSON.stringify(output) } }] }, 200));
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider().generate("FOUNDER", "Build a useful service", "")).toEqual(output);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/chat/completions");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-only-key");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.messages[0].content).toContain("Metric keys must be unique ASCII lowercase snake_case");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts a complete JSON object wrapped in a markdown fence", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const result = { summary: "Ready", tasks: [], reports: [], metrics: [{ key: "Monthly Active Users", label: "Monthly active users", value: 12, unit: "" }] };
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ choices: [{ message: { content: `\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\`\n` } }] }, 200));
    vi.stubGlobal("fetch", fetchMock);
    expect((await provider().generate("ANALYST", "Build a useful service", "")).metrics[0].key).toBe("monthly_active_users");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries one malformed response, then accepts a valid repair", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const valid = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify({ summary: "missing arrays" }) } }] }, 200))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(valid) } }] }, 200));
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider().generate("FOUNDER", "Build a useful service", "")).toEqual(valid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondRequest.messages[2].content).toContain("Correct these fields");
    expect(secondRequest.messages[2].content).not.toContain("missing arrays");
    expect(vi.mocked(console.warn).mock.calls).toEqual([["Forge AI provider retry", { kind: "FOUNDER", attempt: 1, code: "AI_INVALID_RESULT" }]]);
  });

  it("repairs an invalid model-generated metric key before returning output", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const withKey = (key: string) => ({ summary: "Ready", tasks: [], reports: [], metrics: [{ key, label: "Monthly active users", value: 12, unit: "" }] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(withKey("../unsafe")) } }] }, 200))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(withKey("Monthly Active Users")) } }] }, 200));
    vi.stubGlobal("fetch", fetchMock);
    expect((await provider().generate("ANALYST", "Build a useful service", "")).metrics[0].key).toBe("monthly_active_users");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns repeated malformed provider output into a safe error after two attempts", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ choices: [{ message: { content: "not JSON" } }] }, 200));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generate("ANALYST", "Build a useful service", "")).rejects.toMatchObject({ code: "AI_INVALID_RESULT", message: expect.stringContaining("invalid structured result after one retry") });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "rejected its credentials", "AI_ACCESS_DENIED"],
    [403, "rejected its credentials", "AI_ACCESS_DENIED"],
    [429, "rate limit reached", "AI_RATE_LIMITED"],
    [400, "request failed (400)", "AI_PROVIDER"],
  ])("cancels HTTP %s error bodies without retrying", async (status, message, code) => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const cancel = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generate("ANALYST", "Build a useful service", "")).rejects.toMatchObject({ code, message: expect.stringContaining(message) });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([502, 503, 504])("reports a persistent HTTP %s outage safely after one retry", async status => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockImplementation(async () => new Response("Private provider details", { status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toMatchObject({ code: "AI_UNAVAILABLE", message: `AI provider request failed (${status}).` });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([502, 503, 504])("cancels and retries a temporary HTTP %s provider outage within the route time budget", async status => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const output = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const cancel = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status })).mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider().generate("FOUNDER", "Build a useful service", "")).toEqual(output);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(AGENT_REQUEST_TIMEOUT_MS * 2).toBeLessThan(120_000);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) });
    expect(vi.mocked(console.warn).mock.calls).toEqual([["Forge AI provider retry", { kind: "FOUNDER", attempt: 1, code: "AI_UNAVAILABLE" }]]);
  });

  it.each([new DOMException("private timeout details", "TimeoutError"), new TypeError("private connection details")])("recovers one transient fetch failure without changing the original prompt", async error => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const output = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const fetchMock = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await provider().generate("FOUNDER", "Build a useful service", "")).toEqual(output);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[1][1].signal).not.toBe(fetchMock.mock.calls[0][1].signal);
    expect(vi.mocked(console.warn).mock.calls).toEqual([["Forge AI provider retry", { kind: "FOUNDER", attempt: 1, code: "AI_UNAVAILABLE" }]]);
  });

  it("recovers an interrupted body and releases its reader before retrying", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const output = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const interrupted = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private stream details")); } });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(interrupted)).mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await provider().generate("FOUNDER", "Build a useful service", "")).toEqual(output);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(interrupted.locked).toBe(false);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  });

  it("aborts a stalled response body and retries with a fresh timeout signal", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    const output = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const fetchMock = vi.fn().mockImplementationOnce(async (_url: string, init: RequestInit) => new Response(new ReadableStream({
      start(controller) { init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true }); },
    }))).mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = provider().generate("FOUNDER", "Build a useful service", "");
    await vi.advanceTimersByTimeAsync(AGENT_REQUEST_TIMEOUT_MS);

    expect(await result).toEqual(output);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
    expect(vi.mocked(console.warn).mock.calls).toEqual([["Forge AI provider retry", { kind: "FOUNDER", attempt: 1, code: "AI_TIMEOUT" }]]);
  });

  it.each(["fetch", "body"])("reports a timeout when both %s attempts stall within the shared route budget", async stage => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("private timeout details", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => stage === "body"
      ? Promise.resolve(new Response(new ReadableStream({ start(controller) { init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true }); } })))
      : new Promise((_resolve, reject) => { init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }); }));
    vi.stubGlobal("fetch", fetchMock);
    const startedAt = Date.now();
    const failure = expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toMatchObject({ code: "AI_TIMEOUT", message: stage === "body" ? "AI provider response timed out or could not be read." : "AI provider request timed out or could not connect." });

    await vi.advanceTimersByTimeAsync(AGENT_REQUEST_TIMEOUT_MS * 2);
    await failure;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call => call[1].signal.aborted)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(120_000);
    expect(vi.mocked(console.warn).mock.calls).toEqual([["Forge AI provider retry", { kind: "FOUNDER", attempt: 1, code: "AI_TIMEOUT" }]]);
  });

  it("never logs model output, project input, validation hints, or credentials with retry metadata", async () => {
    config.demoMode = "false";
    config.apiKey = "private-provider-key";
    const output = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify({ summary: "private-model-output", tasks: "private-invalid-value" }) } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await provider().generate("ANALYST", "private-project-goal", "private-project-context")).toEqual(output);
    expect(vi.mocked(console.warn).mock.calls).toEqual([["Forge AI provider retry", { kind: "ANALYST", attempt: 1, code: "AI_INVALID_RESULT" }]]);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("Correct these fields");
  });

  it("reports a rate limit on the retry instead of masking it with the first timeout", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(AbortSignal.abort(new DOMException("Private timeout details", "TimeoutError")));
    const fetchMock = vi.fn().mockRejectedValueOnce(new DOMException("Private timeout details", "TimeoutError"))
      .mockResolvedValueOnce(new Response("Private limit details", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toMatchObject({ code: "AI_RATE_LIMITED", message: "AI provider rate limit reached. Try again later." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not add a third attempt for malformed output after transport recovery", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Connection failed"))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "not JSON" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toThrow("invalid structured result after one retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not add a third attempt for a transport failure during JSON repair", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "not JSON" } }] }))
      .mockRejectedValueOnce(new TypeError("private connection details"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toMatchObject({ code: "AI_UNAVAILABLE", message: "AI provider request timed out or could not connect." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized metadata before parsing a valid-looking result", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ reasoning: "x".repeat(600_000), choices: [{ message: { content: '{"summary":"Ready","tasks":[],"reports":[],"metrics":[]}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toMatchObject({ code: "AI_INVALID_RESULT", message: expect.stringContaining("size limit") });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["content_filter", "tool_calls"])("rejects an incomplete %s response even with valid-looking JSON", async finish_reason => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ choices: [{ finish_reason, message: { content: '{"summary":"Ready","tasks":[],"reports":[],"metrics":[]}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toBeInstanceOf(AiProviderError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("turns timeout and interrupted body reads into fixed safe errors", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const timedOutFetch = vi.fn().mockRejectedValue(new DOMException("private timeout details", "TimeoutError"));
    vi.stubGlobal("fetch", timedOutFetch);
    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toThrow("timed out or could not connect");
    expect(timedOutFetch).toHaveBeenCalledTimes(2);
    const interruptedFetch = vi.fn().mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private stream details")); } })));
    vi.stubGlobal("fetch", interruptedFetch);
    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toMatchObject({ code: "AI_UNAVAILABLE", message: "AI provider response timed out or could not be read." });
    expect(interruptedFetch).toHaveBeenCalledTimes(2);
  });
});
