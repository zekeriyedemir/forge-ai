import { describe, expect, it } from "vitest";
import { projectInput } from "./validation";

describe("project validation", () => {
  it("accepts a useful project and trims input", () => {
    expect(projectInput.parse({ name: "  Atlas  ", goal: " Reach a thousand customers " }).name).toBe("Atlas");
  });
  it("rejects empty or oversized goals", () => {
    expect(projectInput.safeParse({ name: "Atlas", goal: "short" }).success).toBe(false);
    expect(projectInput.safeParse({ name: "Atlas", goal: "x".repeat(2001) }).success).toBe(false);
  });
});
