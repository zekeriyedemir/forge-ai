import { describe, expect, it } from "vitest";
import { branchSchema, featureBranch, proposalSchema, safeTarget } from "./contracts";

const valid = { task: "Add a useful endpoint", summary: "Add an endpoint that returns the current task list.", files: [{ path: "src/app/tasks/route.ts", content: "export const GET = () => Response.json([]);", reason: "Expose existing tasks to the UI" }], validationPlan: "Run unit tests and inspect CI on the pull request.", risks: "Access checks must remain server-side.", commitMessage: "feat: add task listing endpoint" };

describe("Developer proposal boundaries", () => {
  it("accepts bounded structured code changes and deterministic Forge branches", () => {
    expect(proposalSchema.parse(valid).files).toHaveLength(1);
    expect(proposalSchema.safeParse({ ...valid, files: [{ ...valid.files[0], path: "src/app/projects/[id]/page.tsx" }] }).success).toBe(true);
    expect(featureBranch("Add a useful endpoint!", "abcdef12-0000-0000-0000-000000000000")).toBe("forge/add-a-useful-endpoint-abcdef12");
    expect(branchSchema.safeParse("main").success).toBe(false);
    expect(safeTarget("dev")).toBe("dev");
  });

  it.each([".env", "src/.env", "src/../.env", "src/logo.png", "src/app/.github/workflows/a.yml", "/src/app/a.ts", "src\\app\\a.ts"]) ("rejects dangerous path %s", path => {
    expect(proposalSchema.safeParse({ ...valid, files: [{ ...valid.files[0], path }] }).success).toBe(false);
  });

  it("rejects binary data, secrets, duplicates, oversized changes, and invalid commit messages", () => {
    expect(proposalSchema.safeParse({ ...valid, files: [{ ...valid.files[0], content: "binary\u0000data" }] }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...valid, files: [{ ...valid.files[0], content: "-----BEGIN PRIVATE KEY-----" }] }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...valid, files: Array(2).fill(valid.files[0]) }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...valid, files: [{ ...valid.files[0], content: "x".repeat(32_001) }] }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...valid, commitMessage: "changed stuff" }).success).toBe(false);
  });
});
