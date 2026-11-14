import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ project: vi.fn(), runs: vi.fn(), executions: vi.fn() }));
vi.mock("@/lib/access", () => ({ requireProject: mocks.project }));
vi.mock("@/lib/db", () => ({ db: { agentRun: { findMany: mocks.runs }, developerExecution: { findMany: mocks.executions } } }));
import Agents from "./page";

beforeEach(() => { vi.clearAllMocks(); mocks.project.mockResolvedValue({}); mocks.executions.mockResolvedValue([]); });

function run(id: string, workflowId: string, step: number, overrides = {}) {
  return { id, workflowId, step, type: ["FOUNDER", "RESEARCH", "FOUNDER", "DEVELOPER", "ANALYST"][step], status: "COMPLETED", provider: "test-provider", model: null, error: null, createdAt: new Date(workflowId === "latest" ? "2026-10-05T12:00:00Z" : "2026-10-04T12:00:00Z"), events: [], ...overrides };
}

describe("agent workflow history", () => {
  it("groups attempts in execution order and distinguishes skipped agents from the failed step", async () => {
    const skipped = { status: "FAILED", provider: null, error: "Skipped because an earlier agent failed" };
    mocks.runs.mockResolvedValue([
      run("last", "latest", 4, skipped),
      run("research", "latest", 1, { status: "FAILED", provider: null, error: "private-provider-diagnostic", events: [{ id: "failure", kind: "failed", message: "private-provider-diagnostic", data: { code: "RESEARCH_UNAVAILABLE" } }] }),
      run("refinement", "latest", 2, skipped),
      run("first", "latest", 0),
      run("developer", "latest", 3, skipped),
      run("older", "older", 0, { provider: "earlier-attempt-provider" }),
    ]);
    const markup = renderToStaticMarkup(await Agents({ params: Promise.resolve({ id: "project" }) }));
    const headingText = [...markup.matchAll(/<h4\b[^>]*>(.*?)<\/h4>/g)].map(match => match[1].replace(/<[^>]*>/g, ""));
    expect(headingText).toEqual(["1founder Agent", "2research Agent", "3founder Agent", "4developer Agent", "5analyst Agent", "1founder Agent"]);
    expect(markup.indexOf("Latest workflow")).toBeLessThan(markup.indexOf("Earlier workflow"));
    expect(markup.match(/>skipped<\/span>/g)).toHaveLength(3);
    expect(markup.match(/>failed<\/span>/g)).toHaveLength(1);
    expect(markup).toContain("npm run research:start");
    expect(markup).toContain("Not started");
    expect(markup).not.toContain("Awaiting execution");
    expect(markup).not.toContain("private-provider-diagnostic");
  });

  it("does not expose arbitrary legacy failure messages", async () => {
    mocks.runs.mockResolvedValue([run("legacy", "older", 0, { status: "FAILED", error: "private-provider-diagnostic", events: [{ id: "legacy-event", kind: "failed", message: "private-provider-diagnostic" }] })]);
    const markup = renderToStaticMarkup(await Agents({ params: Promise.resolve({ id: "project" }) }));
    expect(markup).toContain("We couldn&#x27;t complete this workflow. Please try again.");
    expect(markup).not.toContain("private-provider-diagnostic");
  });
});
