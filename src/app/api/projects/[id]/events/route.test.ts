import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), project: vi.fn(), events: vi.fn() }));
vi.mock("@/lib/access", () => ({ currentUserId: mocks.user, projectForUser: mocks.project }));
vi.mock("@/lib/db", () => ({ db: { agentEvent: { findMany: mocks.events } } }));
import { GET } from "./route";

const projectId = "00000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ id: projectId }) };
const request = (suffix = "") => new Request(`http://localhost/api/projects/${projectId}/events${suffix}`);
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue("user-id"); mocks.project.mockResolvedValue({ id: projectId }); mocks.events.mockResolvedValue([]); });

describe("project event access", () => {
  it("rejects anonymous users before reading events", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(401);
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it("conceals another workspace's events", async () => {
    mocks.project.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(404);
    expect(mocks.project).toHaveBeenCalledWith(projectId, "user-id");
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it("rejects invalid cursors and scopes valid reads to the authorized project", async () => {
    expect((await GET(request("?cursor=invalid"), params)).status).toBe(400);
    expect(mocks.events).not.toHaveBeenCalled();
    expect((await GET(request(), params)).status).toBe(200);
    expect(mocks.events).toHaveBeenCalledWith(expect.objectContaining({ where: { run: { projectId } }, take: 100 }));
  });
});
