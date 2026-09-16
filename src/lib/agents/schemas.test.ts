import { describe, expect, it } from "vitest";
import { metricKeySchema, resultSchema } from "./schemas";

describe("structured agent result", () => {
  it.each([
    ["Monthly Active Users", "monthly_active_users"],
    ["DAUCount", "dau_count"],
    ["validated-customers", "validated_customers"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(metricKeySchema.parse(input)).toBe(expected);
  });

  it.each(["../secret", "__proto__", "30 day retention", "active\nusers", "A".repeat(81)])("rejects unsafe or malformed key %s", key => {
    expect(metricKeySchema.safeParse(key).success).toBe(false);
  });

  it("rejects two metrics that collide after normalization", () => {
    const output = { summary: "Measured activity", tasks: [], reports: [], metrics: [
      { key: "Active Users", label: "Active users", value: 10, unit: "" },
      { key: "active-users", label: "Another metric", value: 11, unit: "" },
    ] };
    expect(resultSchema.safeParse(output).success).toBe(false);
  });

  it("rejects tool-invalid fields before any runtime write", () => {
    expect(resultSchema.safeParse({ summary: "Ready", tasks: [{ title: "x", description: "" }], reports: [], metrics: [] }).success).toBe(false);
    expect(resultSchema.safeParse({ summary: "Ready", tasks: [], reports: [], metrics: [{ key: "revenue", label: "Revenue", value: Infinity, unit: "" }] }).success).toBe(false);
  });
});
