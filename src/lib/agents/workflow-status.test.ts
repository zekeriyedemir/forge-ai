import { describe, expect, it } from "vitest";
import { runFailure, runPresentation, SKIPPED_ERROR, workflowFailure } from "./workflow-status";

describe("safe workflow status", () => {
  it.each([undefined, null, 1, {}, "private-key", "__proto__", "constructor", "toString"])("uses fixed fallback copy for an unknown code: %j", code => {
    expect(workflowFailure(code)).toEqual({ code: "EXECUTION_FAILED", message: "We couldn't complete this workflow. Please try again." });
  });

  it("uses the most recent structured failure event and ignores raw provider text", () => {
    const failure = runFailure({ status: "FAILED", error: "Raw error with private-key", events: [
      { kind: "failed", data: { code: "RESEARCH_ACCESS_DENIED" } },
      { kind: "started", data: { code: "AI_PROVIDER" } },
      { kind: "failed", data: { code: "RESEARCH_UNAVAILABLE" } },
    ] });
    expect(failure.code).toBe("RESEARCH_UNAVAILABLE");
    expect(failure.message).toContain("npm run research:start");
    expect(failure.message).not.toContain("private-key");
  });

  it("recognizes a safe legacy error only when the complete message matches", () => {
    const safeMessage = "We couldn't retrieve research sources. Please try again or check the research integration.";
    expect(runFailure({ status: "FAILED", error: safeMessage }).code).toBe("RESEARCH_PROVIDER");
    expect(runFailure({ status: "FAILED", error: `${safeMessage} private-key` }).code).toBe("EXECUTION_FAILED");
  });

  it("uses a safe API failure code without accepting its raw error text", () => {
    const failure = runFailure({ status: "FAILED", errorCode: "RESEARCH_ACCESS_DENIED", error: "HTTP 403 Authorization: private-key" });
    expect(failure.code).toBe("RESEARCH_ACCESS_DENIED");
    expect(failure.message).toContain("enable JSON");
    expect(failure.message).not.toContain("private-key");
  });

  it("distinguishes skipped successors from the agent that actually failed", () => {
    expect(runPresentation({ status: "FAILED", error: SKIPPED_ERROR })).toEqual({ status: "SKIPPED", label: "skipped", message: "Did not run because an earlier step failed." });
    expect(runPresentation({ status: "FAILED", error: "private-key" })).toEqual({ status: "FAILED", label: "failed", message: "We couldn't complete this workflow. Please try again." });
    expect(runPresentation({ status: "RUNNING", error: SKIPPED_ERROR })).toEqual({ status: "RUNNING", label: "running", message: null });
  });

  it.each([
    ["PENDING", "queued"],
    ["RUNNING", "running"],
    ["COMPLETED", "completed"],
  ])("does not display old error text for %s runs", (status, label) => {
    expect(runPresentation({ status, error: "private-key" })).toEqual({ status, label, message: null });
  });
});
