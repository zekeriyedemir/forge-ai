import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ serverEnv: () => ({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "test-model", OPENAI_BASE_URL: "https://example.test/v1" }) }));
vi.mock("@/lib/agents/provider", () => ({ AiProviderError: class AiProviderError extends Error {} }));
import { generateDeveloperProposal } from "./proposal";
import { DeveloperProposalError } from "./diagnostics";

const context = { paths: ["src/app/page.tsx"], files: [{ path: "src/app/page.tsx", content: "export default function Page() { return null; }" }] };
const proposal = { task: "Improve home page", summary: "Render a useful welcome message on the home page.", files: [{ path: "src/app/page.tsx", content: "export default function Page() { return <main>Welcome</main>; }", reason: "Display a welcome message" }], validationPlan: "Run the app checks and review CI on GitHub.", risks: "The visual layout might require a manual review.", commitMessage: "feat: improve home page welcome" };

beforeEach(() => vi.unstubAllGlobals());

describe("Developer structured output", () => {
  it("accepts valid fenced JSON and never passes a GitHub token to the provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\`` } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await generateDeveloperProposal("Improve home page", context)).toEqual(proposal);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain("Improve home page");
    expect(body.messages[1].content).not.toContain("ghp_");
  });

  it("retries malformed output once, then fails without accepting it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not-json" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateDeveloperProposal("Improve home page", context)).rejects.toMatchObject({ stage: "structured-output", code: "MALFORMED_JSON" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects replacements for existing files the model did not inspect", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateDeveloperProposal("Improve home page", { paths: ["src/app/page.tsx"], files: [] })).rejects.toMatchObject({ stage: "repository-validation", code: "UNINSPECTED_FILE" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("identifies schema-invalid model output by field without echoing its raw content", async () => {
    const invalid = { ...proposal, files: [{ ...proposal.files[0], path: "../.env", content: "sensitive user-provided content" }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(invalid) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    try { await generateDeveloperProposal("Improve home page", context); throw new Error("Expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(DeveloperProposalError);
      const failure = error as DeveloperProposalError;
      expect(failure).toMatchObject({ stage: "structured-output", code: "INVALID_SCHEMA" });
      expect(failure.publicMessage).toContain("files.0.path");
      expect(failure.publicMessage).not.toContain("sensitive user-provided content");
      const retry = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(retry.messages.at(-1).content).toContain("files.0.path");
      expect(retry.messages.at(-1).content).not.toContain("sensitive user-provided content");
    }
  });

  it.each([[401, "ACCESS_DENIED"], [429, "RATE_LIMITED"], [503, "HTTP_ERROR"]])("classifies provider HTTP %i as %s without reading the response body", async (status, code) => {
    const text = vi.fn(async () => "secret provider response");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, text }));
    await expect(generateDeveloperProposal("Improve home page", context)).rejects.toMatchObject({ stage: "ai-provider", code });
    expect(text).not.toHaveBeenCalled();
  });
});
