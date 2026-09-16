import { ZodError } from "zod";

export type ProposalFailureStage = "github-inspection" | "branch-base" | "repository-validation" | "ai-provider" | "structured-output" | "proposal-validation" | "database";

export class DeveloperProposalError extends Error {
  constructor(readonly stage: ProposalFailureStage, readonly code: string, reason: string) {
    super(reason);
    this.name = "DeveloperProposalError";
  }

  get publicMessage() { return `Proposal failed during ${this.stage.replaceAll("-", " ")} (${this.code}): ${this.message}`; }
}

export class RepositoryValidationError extends Error {}

export function schemaFields(error: ZodError): string {
  const allowed = new Set(["task", "summary", "files", "path", "content", "reason", "validationPlan", "risks", "commitMessage"]);
  const fields = [...new Set(error.issues.map(issue => issue.path.filter(part => typeof part === "number" || allowed.has(String(part))).join(".") || "root"))].slice(0, 4);
  return fields.join(", ");
}
