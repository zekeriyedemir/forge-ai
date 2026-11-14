// Client-safe, fixed copy only. Never display arbitrary persisted/provider errors.
const messages = {
  RESEARCH_NOT_CONFIGURED: "Research is not configured. Set a SearXNG URL or a Brave Search API key before running the workflow.",
  RESEARCH_UNAVAILABLE: "The research search service is unreachable or timed out. Start your configured SearXNG service (Docker: npm run research:start), then try again.",
  RESEARCH_ACCESS_DENIED: "The research service denied access. For SearXNG, enable JSON search responses; for Brave, check the search API key.",
  RESEARCH_RATE_LIMITED: "The research service reached its request limit. Wait a moment, then try again.",
  RESEARCH_INVALID_RESPONSE: "The research service returned an invalid response. Check that the configured endpoint supports JSON search.",
  RESEARCH_NO_RESULTS: "Research found no usable public sources. Refine the goal or check your search service, then try again.",
  RESEARCH_NO_READABLE_SOURCES: "Search worked, but the source pages could not be read. Try again or refine the goal to find other sources.",
  RESEARCH_PROVIDER: "We couldn't retrieve research sources. Please try again or check the research integration.",
  RESEARCH_SYNTHESIS: "We couldn't finish analyzing the research. Please try again.",
  AI_NOT_CONFIGURED: "AI is not configured. Check the server's AI key, model, and provider settings before running the workflow.",
  AI_PROVIDER: "We couldn't get a complete response from the AI provider. Please try again or check your AI configuration.",
  AI_TIMEOUT: "The AI provider took too long to respond after a retry. Try again, or configure a faster model if this keeps happening.",
  AI_UNAVAILABLE: "The AI provider could not complete the request. Check the provider's availability, then try again.",
  AI_ACCESS_DENIED: "The AI provider denied access. Check the server's API key and access to the configured model.",
  AI_RATE_LIMITED: "The AI provider reached its request limit. Wait for the limit to reset, then run the workflow again.",
  AI_INVALID_RESULT: "The AI provider returned a result Forge couldn't validate. Try again or choose a model that supports JSON output.",
  METRIC_CONFLICT: "A generated metric conflicts with an existing metric. Please review your metrics and try again.",
  INVALID_RESULT: "We couldn't complete this workflow. Please try again.",
  EXECUTION_FAILED: "We couldn't complete this workflow. Please try again.",
} as const;

export type WorkflowFailureCode = keyof typeof messages;
export const SKIPPED_ERROR = "Skipped because an earlier agent failed";

export function workflowFailure(code: unknown): { code: WorkflowFailureCode; message: string } {
  const safeCode = typeof code === "string" && Object.hasOwn(messages, code) ? code as WorkflowFailureCode : "EXECUTION_FAILED";
  return { code: safeCode, message: messages[safeCode] };
}

export type PresentedRun = { status: string; error?: string | null; errorCode?: unknown; events?: { kind: string; data?: unknown }[] };

export function runFailure(run: PresentedRun) {
  const event = run.events?.findLast(item => item.kind === "failed");
  const data = event?.data;
  const eventCode = data && typeof data === "object" && "code" in data ? data.code : undefined;
  const legacyCode = Object.entries(messages).find(([, message]) => message === run.error)?.[0];
  return workflowFailure(run.errorCode ?? eventCode ?? legacyCode);
}

export function runPresentation(run: PresentedRun): { status: string; label: string; message: string | null } {
  if (run.status === "FAILED" && run.error === SKIPPED_ERROR) return { status: "SKIPPED", label: "skipped", message: "Did not run because an earlier step failed." };
  if (run.status === "FAILED") return { status: "FAILED", label: "failed", message: runFailure(run).message };
  if (run.status === "COMPLETED") return { status: "COMPLETED", label: "completed", message: null };
  if (run.status === "RUNNING") return { status: "RUNNING", label: "running", message: null };
  return { status: "PENDING", label: "queued", message: null };
}
