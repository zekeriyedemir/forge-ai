import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ProposalError extends Error { get publicMessage() { return `Proposal failed during structured output (INVALID_SCHEMA): ${this.message}`; } }
  class FlowError extends Error {}
  class GitHubError extends Error {}
  class RepositoryError extends Error {}
  class AiError extends Error {}
  return { ProposalError, FlowError, GitHubError, RepositoryError, AiError, user: vi.fn(), owner: vi.fn(), create: vi.fn(), revalidate: vi.fn(), redirect: vi.fn() };
});

vi.mock("@/lib/access", () => ({ authenticatedUserId: mocks.user, projectForOwner: mocks.owner }));
vi.mock("@/lib/db", () => ({ db: { approvalRequest: { findFirst: vi.fn() } } }));
vi.mock("@/lib/developer/runtime", () => ({ DeveloperFlowError: mocks.FlowError, createDeveloperProposal: mocks.create, decideApproval: vi.fn(), executeImplementation: vi.fn(), executeMerge: vi.fn(), retryApproval: vi.fn() }));
vi.mock("@/lib/developer/diagnostics", () => ({ DeveloperProposalError: mocks.ProposalError, RepositoryValidationError: mocks.RepositoryError }));
vi.mock("@/lib/developer/github", () => ({ DeveloperGitHubError: mocks.GitHubError }));
vi.mock("@/lib/agents/provider", () => ({ AiProviderError: mocks.AiError }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { mocks.redirect(path); throw new Error(`redirect:${path}`); } }));

import { proposeDevelopment } from "./developer-actions";

const projectId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
const form = () => { const data = new FormData(); data.set("taskId", taskId); return data; };

beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue("owner-id"); mocks.owner.mockResolvedValue({ id: projectId }); });

describe("Developer proposal action diagnostics", () => {
  it("shows the sanitized structured-output reason even when the custom error name is Error", async () => {
    mocks.create.mockRejectedValue(new mocks.ProposalError("The model omitted files.0.path."));
    await expect(proposeDevelopment(projectId, form())).rejects.toThrow("redirect:");
    const destination = mocks.redirect.mock.calls[0][0] as string;
    expect(decodeURIComponent(destination)).toContain("structured output (INVALID_SCHEMA)");
    expect(decodeURIComponent(destination)).toContain("files.0.path");
    expect(destination).not.toContain("Operation%20failed");
  });

  it("shows a safe GitHub error and keeps unknown errors generic", async () => {
    mocks.create.mockRejectedValueOnce(new mocks.GitHubError("GitHub authorization expired. Sign in again."));
    await expect(proposeDevelopment(projectId, form())).rejects.toThrow("redirect:");
    expect(decodeURIComponent(mocks.redirect.mock.calls[0][0])).toContain("GitHub authorization expired");
    mocks.create.mockRejectedValueOnce(new Error("private database URL from unexpected exception"));
    await expect(proposeDevelopment(projectId, form())).rejects.toThrow("redirect:");
    expect(decodeURIComponent(mocks.redirect.mock.calls[1][0])).toContain("Operation failed. Review the project activity and retry.");
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain("private database URL");
  });
});
