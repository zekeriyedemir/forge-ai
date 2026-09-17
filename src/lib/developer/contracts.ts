import { z } from "zod";

export const safePath = z.string()
  .transform(path => {
    const trimmed = path.trim();
    return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
  })
  .pipe(z.string().min(1).max(180).refine(path => {
    if (path.includes("\\") || path.includes("..") || path.startsWith("/") || /[\u0000-\u001f\u007f]/.test(path)) return false;
    const parts = path.split("/");
    if (parts.some(part => !part || part.startsWith(".") || /(?:^|[_-])(?:secret|secrets|credential|credentials|password|token|private[_-]?key|api[_-]?key)(?:[_.-]|$)/i.test(part) || !/^(?:[A-Za-z0-9_-]+|\[[A-Za-z0-9_-]+\])(?:\.[A-Za-z0-9_-]+)*$/.test(part))) return false;
    return ["src", "app", "pages", "components", "lib", "tests", "docs"].includes(parts[0]) && /\.(?:ts|tsx|js|jsx|css|md|json)$/.test(path);
  }, "Only ordinary text source, test, and documentation paths are supported"));

export const fileChangeSchema = z.object({
  path: safePath,
  // Optional only so proposals persisted before this migration remain executable.
  operation: z.enum(["CREATE", "UPDATE"]).optional(),
  content: z.string().min(1).max(32_000).refine(value => !/[\u0000-\u0008\u000e-\u001f]/.test(value), "Binary/control data is not supported")
    .refine(value => !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}/.test(value), "Credential-like content is not supported"),
  reason: z.string().trim().min(5).max(500),
}).strict();

export const proposalSchema = z.object({
  task: z.string().trim().min(5).max(300),
  summary: z.string().trim().min(10).max(2000),
  files: z.array(fileChangeSchema).min(1).max(5),
  validationPlan: z.string().trim().min(10).max(1000),
  validationExpectation: z.string().trim().min(10).max(1000).optional(),
  risks: z.string().trim().min(5).max(1000),
  commitMessage: z.string().trim().regex(/^(feat|fix|test|docs|refactor): [^\r\n]{8,70}$/),
}).strict().superRefine((proposal, ctx) => {
  const paths = proposal.files.map(file => file.path);
  if (new Set(paths).size !== paths.length) ctx.addIssue({ code: "custom", path: ["files"], message: "Duplicate file paths" });
  if (proposal.files.reduce((sum, file) => sum + file.content.length, 0) > 64_000) ctx.addIssue({ code: "custom", path: ["files"], message: "Total change size exceeds 64 KB" });
});

export type DeveloperProposal = z.infer<typeof proposalSchema>;
const credentialLike = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|postgres(?:ql)?:\/\/[^\s]+|(?:API_KEY|SECRET|PASSWORD|DATABASE_URL|AUTH_TOKEN)\s*[:=]\s*["']?[^\s"']{8,}/i;
export const generatedProposalSchema = proposalSchema.superRefine((proposal, ctx) => {
  proposal.files.forEach((file, index) => {
    if (!file.operation) ctx.addIssue({ code: "custom", path: ["files", index, "operation"], message: "CREATE or UPDATE is required" });
  });
  if (!proposal.validationExpectation) ctx.addIssue({ code: "custom", path: ["validationExpectation"], message: "Expected CI success is required" });
  for (const field of ["task", "summary", "validationPlan", "validationExpectation", "risks", "commitMessage"] as const) {
    if (credentialLike.test(proposal[field] ?? "")) ctx.addIssue({ code: "custom", path: [field], message: "Credential-like text is not supported" });
  }
  proposal.files.forEach((file, index) => { if (credentialLike.test(file.reason) || credentialLike.test(file.content)) ctx.addIssue({ code: "custom", path: ["files", index], message: "Credential-like text is not supported" }); });
});
export const ciFixSchema = generatedProposalSchema.safeExtend({
  failureSummary: z.string().trim().min(10).max(1000),
  likelyCause: z.string().trim().min(10).max(1000),
}).superRefine((proposal, ctx) => {
  for (const field of ["failureSummary", "likelyCause"] as const) if (credentialLike.test(proposal[field])) ctx.addIssue({ code: "custom", path: [field], message: "Credential-like text is not supported" });
});
export type CiFixProposal = z.infer<typeof ciFixSchema>;
export const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);
export const branchSchema = z.string().regex(/^forge\/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}$/);

export function featureBranch(task: string, id: string) {
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "") || "task";
  return branchSchema.parse(`forge/${slug}-${id.replace(/-/g, "").slice(0, 8)}`);
}

export function safeTarget(branch: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith("/")) throw new Error("Unsafe target branch");
  return branch;
}
