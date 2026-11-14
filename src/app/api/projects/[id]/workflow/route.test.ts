import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), ownerProject: vi.fn(), findRun: vi.fn(), findRuns: vi.fn(), start: vi.fn(), advance: vi.fn() }));
vi.mock("@/lib/access", () => ({ currentUserId: mocks.user, projectForOwner: mocks.ownerProject }));
vi.mock("@/lib/db", () => ({ db: { agentRun: { findFirst: mocks.findRun, findMany: mocks.findRuns } } }));
vi.mock("@/lib/agents/runtime", () => ({
  startWorkflow: mocks.start,
  advanceWorkflow: mocks.advance,
  WorkflowLimitError: class WorkflowLimitError extends Error { constructor() { super("Workflow limit reached. Try again later."); } },
  WorkflowPreflightError: class WorkflowPreflightError extends Error { constructor(readonly code: unknown) { super("Preflight failed"); } },
}));
import { POST, PATCH } from "./route";
import { WorkflowLimitError, WorkflowPreflightError } from "@/lib/agents/runtime";
import { SKIPPED_ERROR } from "@/lib/agents/workflow-status";

const projectId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: projectId }) };
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe("workflow route authorization", () => {
  it("rejects anonymous starts before database writes", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await POST(new Request(`http://localhost/api/projects/${projectId}/workflow`, { method: "POST" }), context);
    expect(response.status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects writes for a project the user does not own", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue(null);
    const request = new Request(`http://localhost/api/projects/${projectId}/workflow`, { method: "PATCH", body: JSON.stringify({ workflowId: crypto.randomUUID() }) });
    const response = await PATCH(request, context);
    expect(response.status).toBe(404);
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("starts an owned project and returns the persisted workflow ID", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    mocks.start.mockResolvedValue("workflow-id");
    const response = await POST(new Request(`http://localhost/api/projects/${projectId}/workflow`, { method: "POST" }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workflowId: "workflow-id" });
    expect(mocks.start).toHaveBeenCalledWith(projectId);
  });

  it("returns an actionable rate-limit response without exposing internal errors", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    mocks.start.mockRejectedValue(new WorkflowLimitError());
    const response = await POST(new Request("http://localhost", { method: "POST" }), context);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Workflow limit reached. Try again later." });
  });

  it("returns a safe actionable 503 when live preflight fails", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    const failure = new WorkflowPreflightError("RESEARCH_UNAVAILABLE");
    failure.message = "Connection refused at https://private-key@internal-host";
    mocks.start.mockRejectedValue(failure);

    const response = await POST(new Request("http://localhost", { method: "POST" }), context);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("RESEARCH_UNAVAILABLE");
    expect(body.error).toContain("npm run research:start");
    expect(JSON.stringify(body)).not.toContain("private-key");
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("does not echo an unknown preflight code or message", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    mocks.start.mockRejectedValue(new WorkflowPreflightError("private-key"));

    const response = await POST(new Request("http://localhost", { method: "POST" }), context);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "EXECUTION_FAILED", error: "We couldn't complete this workflow. Please try again." });
  });

  it.each([POST, PATCH])("handles database failures in ownership prechecks with safe JSON", async handler => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockRejectedValue(new Error("postgresql://private-credential@host/db"));
    const response = await handler(new Request("http://localhost", { method: "POST" }), context);
    expect(response.status).toBe(500);
    expect((await response.json()).error).not.toContain("private-credential");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-credential");
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("rejects malformed request JSON and never advances a workflow from another project", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    const malformed = await PATCH(new Request("http://localhost", { method: "PATCH", body: "{" }), context);
    expect(malformed.status).toBe(400);
    expect(mocks.findRun).not.toHaveBeenCalled();
    const workflowId = crypto.randomUUID();
    mocks.findRun.mockResolvedValue(null);
    const wrongProject = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ workflowId }) }), context);
    expect(wrongProject.status).toBe(404);
    expect(mocks.findRun).toHaveBeenCalledWith({ where: { projectId, workflowId } });
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("returns persisted run status after advancing an owned workflow", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    mocks.findRun.mockResolvedValue({ id: "run-id" });
    const runs = [{ id: "run-id", type: "FOUNDER", status: "COMPLETED", error: null }];
    mocks.findRuns.mockResolvedValue(runs);
    const workflowId = crypto.randomUUID();
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ workflowId }) }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runs });
    expect(mocks.advance).toHaveBeenCalledWith(projectId, workflowId);
  });

  it("returns a persisted research failure as workflow state and preserves skipped steps", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    mocks.findRun.mockResolvedValue({ id: "research-run" });
    mocks.advance.mockRejectedValue(new Error("Raw search failure with private-key"));
    mocks.findRuns.mockResolvedValue([
      { id: "founder-run", type: "FOUNDER", status: "COMPLETED", error: null, events: [] },
      { id: "research-run", type: "RESEARCH", status: "FAILED", error: "Raw stored error with private-key", events: [{ kind: "failed", data: { code: "RESEARCH_UNAVAILABLE" } }] },
      { id: "developer-run", type: "DEVELOPER", status: "FAILED", error: SKIPPED_ERROR, events: [] },
    ]);
    const workflowId = crypto.randomUUID();

    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ workflowId }) }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.failure).toMatchObject({ code: "RESEARCH_UNAVAILABLE", message: expect.stringContaining("npm run research:start") });
    expect(body.runs).toEqual([
      { id: "founder-run", type: "FOUNDER", status: "COMPLETED", error: null },
      { id: "research-run", type: "RESEARCH", status: "FAILED", errorCode: "RESEARCH_UNAVAILABLE", error: body.failure.message },
      { id: "developer-run", type: "DEVELOPER", status: "FAILED", error: SKIPPED_ERROR },
    ]);
    expect(mocks.findRuns).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId, workflowId }, orderBy: { step: "asc" } }));
    expect(JSON.stringify([body, vi.mocked(console.error).mock.calls])).not.toContain("private-key");
  });

  it("sanitizes arbitrary errors in historical failed runs", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    mocks.findRun.mockResolvedValue({ id: "old-run" });
    mocks.findRuns.mockResolvedValue([{ id: "old-run", type: "RESEARCH", status: "FAILED", error: "postgresql://private-key@internal-host/database", events: [{ kind: "failed", data: { code: "private-key" } }] }]);

    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ workflowId: crypto.randomUUID() }) }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.failure).toEqual({ code: "EXECUTION_FAILED", message: "We couldn't complete this workflow. Please try again." });
    expect(body.runs[0].error).toBe(body.failure.message);
    expect(JSON.stringify(body)).not.toContain("private-key");
  });

  it("keeps a failure to persist agent state as a retryable server error", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    mocks.findRun.mockResolvedValue({ id: "research-run" });
    mocks.advance.mockRejectedValue(new Error("Database unavailable with private-key"));
    mocks.findRuns.mockResolvedValue([{ id: "research-run", type: "RESEARCH", status: "RUNNING", error: null, events: [] }]);

    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ workflowId: crypto.randomUUID() }) }), context);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "We couldn't complete this workflow. Please try again." });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-key");
  });

  it("returns safe JSON if reading persisted workflow state fails", async () => {
    mocks.user.mockResolvedValue("user-id");
    mocks.ownerProject.mockResolvedValue({ id: projectId });
    mocks.findRun.mockResolvedValue({ id: "research-run" });
    mocks.findRuns.mockRejectedValue(new Error("Database unavailable with private-key"));

    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ workflowId: crypto.randomUUID() }) }), context);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "We couldn't complete this workflow. Please try again." });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-key");
  });
});
