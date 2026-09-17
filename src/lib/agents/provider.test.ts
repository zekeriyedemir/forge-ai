import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ demoMode: "true", apiKey: "" }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ DATABASE_URL: "postgresql://localhost/forge", AUTH_SECRET: "a".repeat(32), DEMO_MODE: config.demoMode, OPENAI_API_KEY: config.apiKey, OPENAI_BASE_URL: "https://example.test/v1/", OPENAI_MODEL: "test-model" }) }));
import { AiProviderError, demoProvider, resultSchema, provider } from "./provider";

beforeEach(() => { config.demoMode = "true"; config.apiKey = ""; vi.unstubAllGlobals(); });

describe("agent provider", () => {
  it("returns structured, clearly identified demo results without a key", async () => {
    const ai = provider();
    expect(ai.name).toBe("mock");
    for (const kind of ["FOUNDER", "RESEARCH", "DEVELOPER", "ANALYST"] as const) {
      const output = await ai.generate(kind, "Build a useful product", "");
      expect(resultSchema.parse(output).summary).toBeTruthy();
    }
  });

  it("keeps the demo research outline mocked even if an AI key is configured", async () => {
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const demo = await demoProvider().generate("RESEARCH", "Build a useful product", "");
    expect(demo.summary).toContain("Demo research outline");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an unconfigured non-demo deployment", () => {
    config.demoMode = "false";
    expect(() => provider()).toThrow(AiProviderError);
  });

  it("uses an OpenAI-compatible endpoint with environment credentials", async () => {
    config.apiKey = "test-only-key";
    const output = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(output) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider().generate("FOUNDER", "Build a useful service", "")).toEqual(output);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/chat/completions");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-only-key");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.messages[0].content).toContain("Metric keys must be unique ASCII lowercase snake_case");
  });

  it("accepts a complete JSON object wrapped in a markdown fence", async () => {
    config.apiKey = "test-only-key";
    const result = { summary: "Ready", tasks: [], reports: [], metrics: [{ key: "Monthly Active Users", label: "Monthly active users", value: 12, unit: "" }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: `\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\`\n` } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect((await provider().generate("ANALYST", "Build a useful service", "")).metrics[0].key).toBe("monthly_active_users");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries one malformed response, then accepts a valid repair", async () => {
    config.apiKey = "test-only-key";
    const valid = { summary: "Ready", tasks: [], reports: [], metrics: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: "missing arrays" }) } }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(valid) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider().generate("FOUNDER", "Build a useful service", "")).toEqual(valid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondRequest.messages[2].content).toContain("Correct these fields");
    expect(secondRequest.messages[2].content).not.toContain("missing arrays");
  });

  it("repairs an invalid model-generated metric key before returning output", async () => {
    config.apiKey = "test-only-key";
    const withKey = (key: string) => ({ summary: "Ready", tasks: [], reports: [], metrics: [{ key, label: "Monthly active users", value: 12, unit: "" }] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(withKey("../unsafe")) } }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(withKey("Monthly Active Users")) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect((await provider().generate("ANALYST", "Build a useful service", "")).metrics[0].key).toBe("monthly_active_users");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns repeated malformed provider output into a safe error after two attempts", async () => {
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not JSON" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generate("ANALYST", "Build a useful service", "")).rejects.toThrow("invalid structured result after one retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry credential failures", async () => {
    config.apiKey = "test-only-key";
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generate("ANALYST", "Build a useful service", "")).rejects.toThrow("rejected its credentials");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
