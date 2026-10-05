import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ demoMode: "true", apiKey: "" }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ DATABASE_URL: "postgresql://localhost/forge", AUTH_SECRET: "a".repeat(32), DEMO_MODE: config.demoMode, OPENAI_API_KEY: config.apiKey, OPENAI_BASE_URL: "https://example.test/v1/", OPENAI_MODEL: "test-model" }) }));
import { AGENT_REQUEST_TIMEOUT_MS, AiProviderError, demoProvider, resultSchema, provider } from "./provider";

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });

beforeEach(() => { config.demoMode = "true"; config.apiKey = ""; vi.unstubAllGlobals(); });

describe("agent provider", () => {
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
    await expect(provider().generate("ANALYST", "Build a useful service", "")).rejects.toThrow("invalid structured result after one retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry credential failures", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generate("ANALYST", "Build a useful service", "")).rejects.toThrow("rejected its credentials");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a temporary provider outage within the route time budget", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const output = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider().generate("FOUNDER", "Build a useful service", "")).toEqual(output);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(AGENT_REQUEST_TIMEOUT_MS * 2).toBeLessThan(120_000);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) });
  });

  it("rejects oversized metadata before parsing a valid-looking result", async () => {
    config.demoMode = "false";
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ reasoning: "x".repeat(600_000), choices: [{ message: { content: '{"summary":"Ready","tasks":[],"reports":[],"metrics":[]}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toThrow("size limit");
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
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("private timeout details", "TimeoutError")));
    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toThrow("timed out or could not connect");
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private stream details")); } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(provider().generate("FOUNDER", "Build a useful service", "")).rejects.toThrow("timed out or could not be read");
  });
});
