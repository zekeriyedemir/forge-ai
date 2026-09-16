import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ serverEnv: () => ({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "test-model", OPENAI_BASE_URL: "https://example.test/v1" }) }));
vi.mock("@/lib/agents/provider", () => ({ AiProviderError: class AiProviderError extends Error {} }));
import { generateDeveloperProposal } from "./proposal";

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
    await expect(generateDeveloperProposal("Improve home page", context)).rejects.toThrow("after one retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects replacements for existing files the model did not inspect", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateDeveloperProposal("Improve home page", { paths: ["src/app/page.tsx"], files: [] })).rejects.toThrow("after one retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
