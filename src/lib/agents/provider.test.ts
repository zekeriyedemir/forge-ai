import { describe, expect, it, vi } from "vitest";
import { resultSchema, provider } from "./provider";

vi.mock("@/lib/env", () => ({ serverEnv: () => ({ DATABASE_URL: "postgresql://localhost/forge", AUTH_SECRET: "a".repeat(32), DEMO_MODE: "true", OPENAI_MODEL: "test-model" }) }));

describe("agent provider", () => {
  it("returns structured, clearly identified demo results without a key", async () => {
    const ai = provider();
    expect(ai.name).toBe("mock");
    for (const kind of ["FOUNDER", "RESEARCH", "DEVELOPER", "ANALYST"] as const) {
      const output = await ai.generate(kind, "Build a useful product", "");
      expect(resultSchema.parse(output).summary).toBeTruthy();
    }
  });
  it("rejects malformed output", () => {
    expect(() => resultSchema.parse({ summary: "x", tasks: [], reports: [], metrics: [{ key: "x", label: "X", value: "bad", unit: "" }] })).toThrow();
  });
});
