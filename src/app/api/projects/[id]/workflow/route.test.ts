import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), ownerProject: vi.fn(), findRun: vi.fn(), findRuns: vi.fn(), start: vi.fn(), advance: vi.fn() }));
vi.mock("@/lib/access", () => ({ currentUserId: mocks.user, projectForOwner: mocks.ownerProject }));
vi.mock("@/lib/db", () => ({ db: { agentRun: { findFirst: mocks.findRun, findMany: mocks.findRuns } } }));
vi.mock("@/lib/agents/runtime", () => ({ startWorkflow: mocks.start, advanceWorkflow: mocks.advance, WorkflowLimitError: class WorkflowLimitError extends Error { constructor() { super("Workflow limit reached. Try again later."); } } }));
import { POST, PATCH } from "./route";
import { WorkflowLimitError } from "@/lib/agents/runtime";

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
});
