import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ serverEnv: () => ({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "test-model", OPENAI_BASE_URL: "https://example.test/v1" }) }));
import { generateDeveloperProposal } from "./proposal";
import { DeveloperProposalError } from "./diagnostics";
import { proposalSchema } from "./contracts";

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
    const system = body.messages[0].content as string;
    for (const required of ["files[*].path", "validationPlan: ONE JSON string", "risks: ONE JSON string", "commitMessage: ONE JSON string", "COMPLETE final text", "64000 characters"]) expect(system).toContain(required);
    const example = system.split("Valid complete example: ")[1].split("\n")[0];
    expect(proposalSchema.safeParse(JSON.parse(example)).success).toBe(true);
  });

  it.each([
    ["files.0.path", { ...proposal, files: [{ ...proposal.files[0], path: "../.env" }] }],
    ["validationPlan", { ...proposal, validationPlan: ["run tests"] }],
    ["risks", { ...proposal, risks: ["CI pending"] }],
    ["commitMessage", { ...proposal, commitMessage: "Add status page" }],
  ])("reports %s precisely after a failed repair", async (field, invalid) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(invalid) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateDeveloperProposal("Improve home page", context)).rejects.toMatchObject({ stage: "structured-output", code: "INVALID_SCHEMA" });
    const secondRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondRequest.messages.at(-1).content).toContain(field);
    expect(secondRequest.messages.at(-1).content).toContain("Valid complete example:");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("repairs invalid field types while preserving valid safe fields", async () => {
    const invalid = { ...proposal, validationPlan: ["run tests"], risks: ["check CI"], commitMessage: "Add page" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(invalid) } }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await generateDeveloperProposal("Improve home page", context)).toEqual(proposal);
    const retry = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retry.messages.at(-1).content).toContain(`"task":"${proposal.task}"`);
    expect(retry.messages.at(-1).content).toContain("validationPlan, risks, commitMessage");
    expect(retry.messages.at(-1).content).toContain("ONLY one corrected complete JSON object");
  });

  it("normalizes a harmless generated path but rejects traversal after both attempts", async () => {
    const safe = { ...proposal, files: [{ ...proposal.files[0], path: "  ./src/app/page.tsx  " }] };
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(safe) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect((await generateDeveloperProposal("Improve home page", context)).files[0].path).toBe("src/app/page.tsx");
    expect(fetchMock).toHaveBeenCalledOnce();
    const unsafe = { ...proposal, files: [{ ...proposal.files[0], path: "./src/../.env" }] };
    const unsafeFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(unsafe) } }] }) });
    vi.stubGlobal("fetch", unsafeFetch);
    await expect(generateDeveloperProposal("Improve home page", context)).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    expect(unsafeFetch).toHaveBeenCalledTimes(2);
  });

  it.each(["Before: " + JSON.stringify(proposal), JSON.stringify(proposal) + "\n" + JSON.stringify(proposal)])("rejects prose or multiple JSON objects instead of extracting one", async raw => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: raw } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateDeveloperProposal("Improve home page", context)).rejects.toMatchObject({ code: "MALFORMED_JSON" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
