import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ demoMode: "true", apiKey: "" }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ DATABASE_URL: "postgresql://localhost/forge", AUTH_SECRET: "a".repeat(32), DEMO_MODE: config.demoMode, OPENAI_API_KEY: config.apiKey, OPENAI_BASE_URL: "https://example.test/v1/", OPENAI_MODEL: "test-model" }) }));
import { AiProviderError, resultSchema, provider } from "./provider";

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
  });

  it("turns malformed provider output into a safe error", async () => {
    config.apiKey = "test-only-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not JSON" } }] }) }));
    await expect(provider().generate("ANALYST", "Build a useful service", "")).rejects.toThrow("invalid structured result");
  });
});
