import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), ownerProject: vi.fn(), count: vi.fn(), findRun: vi.fn(), start: vi.fn(), advance: vi.fn() }));
vi.mock("@/lib/access", () => ({ currentUserId: mocks.user, projectForOwner: mocks.ownerProject }));
vi.mock("@/lib/db", () => ({ db: { agentRun: { count: mocks.count, findFirst: mocks.findRun } } }));
vi.mock("@/lib/agents/runtime", () => ({ startWorkflow: mocks.start, advanceWorkflow: mocks.advance }));
import { POST, PATCH } from "./route";

const projectId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: projectId }) };
beforeEach(() => { vi.clearAllMocks(); mocks.count.mockResolvedValue(0); });

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
});
