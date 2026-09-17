import { z } from "zod";
import { posix } from "node:path";
import { githubToken } from "@/lib/github";
import { branchSchema, safePath, safeTarget, shaSchema, type DeveloperProposal } from "./contracts";
import { RepositoryValidationError } from "./diagnostics";

const repoSchema = z.object({ id: z.number().int().positive(), full_name: z.string(), default_branch: z.string(), permissions: z.object({ push: z.boolean() }).optional() });
const refSchema = z.object({ object: z.object({ sha: shaSchema }) });
const commitSchema = z.object({ sha: shaSchema, tree: z.object({ sha: shaSchema }) });
const pullSchema = z.object({ number: z.number().int().positive(), html_url: z.url().refine(url => new URL(url).origin === "https://github.com"), state: z.string(), mergeable: z.boolean().nullable().optional(), merged: z.boolean().optional(), head: z.object({ sha: shaSchema, ref: z.string(), repo: z.object({ id: z.number() }) }), base: z.object({ ref: z.string(), repo: z.object({ id: z.number() }) }) });

export class DeveloperGitHubError extends Error {}
export type RepoInfo = z.infer<typeof repoSchema>;
export type PullInfo = z.infer<typeof pullSchema>;
export type CiState = "PENDING" | "SUCCESS" | "FAILURE" | "CANCELLED" | "UNAVAILABLE";
export type CiSnapshot = { state: CiState; summary: string; checks: { name: string; status: string; conclusion: string | null }[] };
export type CiFailure = { summary: string; job: string; step: string; diagnostics: string[] };

export interface DeveloperGitHub {
  repository(fullName: string): Promise<RepoInfo>;
  ref(fullName: string, branch: string): Promise<string | null>;
  context(fullName: string, sha: string, task: string): Promise<{ paths: string[]; files: { path: string; content: string }[] }>;
  createBranch(fullName: string, branch: string, sha: string): Promise<void>;
  createCommit(fullName: string, parentSha: string, proposal: DeveloperProposal): Promise<string>;
  updateBranch(fullName: string, branch: string, sha: string): Promise<void>;
  findPull(fullName: string, branch: string): Promise<PullInfo | null>;
  createPull(fullName: string, branch: string, target: string, proposal: DeveloperProposal): Promise<PullInfo>;
  pull(fullName: string, number: number): Promise<PullInfo>;
  checks(fullName: string, sha: string): Promise<{ passed: boolean; summary: string }>;
  ciSnapshot(fullName: string, sha: string): Promise<CiSnapshot>;
  ciFailure(fullName: string, sha: string): Promise<CiFailure>;
  merge(fullName: string, number: number, sha: string): Promise<void>;
}

function repoPath(fullName: string) {
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new DeveloperGitHubError("Invalid linked repository");
  return `/repos/${parts.map(encodeURIComponent).join("/")}`;
}

export function safeLabel(value: string): string {
  const trimmed = value.slice(0, 120).replace(/[\u0000-\u001f\u007f]/g, " ");
  if (!/^[A-Za-z0-9 _./()[\]:-]{1,120}$/.test(trimmed)) return "redacted";
  const words = trimmed.toLowerCase().match(/[a-z]+/g) ?? [];
  const allowed = new Set(["ci", "build", "test", "tests", "unit", "integration", "e2e", "lint", "eslint", "typecheck", "typescript", "check", "checks", "validate", "validation", "compile", "prisma", "migration", "migrate", "npm", "install", "playwright", "vitest", "jest", "node", "app", "web", "frontend", "backend", "workflow", "job", "run", "verify", "format", "security", "scan", "code", "quality", "coverage", "failure", "failed", "success"]);
  return words.length > 0 && words.every(word => allowed.has(word)) && !/\d{6,}/.test(trimmed) ? trimmed : "redacted";
}

export function extractSafeDiagnostics(log: string): string[] {
  // Derive codes and checked paths only; never forward raw log lines or values to the model.
  const results = new Set<string>();
  for (const line of log.slice(0, 32_000).split(/\r?\n/).slice(0, 400)) {
    const ts = /\bTS\d{4,5}\b/.exec(line);
    if (ts) results.add(`TypeScript ${ts[0]}`);
    const eslint = /\b(?:eslint|lint)\b/i.test(line) && /\berror\b/i.test(line);
    if (eslint) results.add("Lint error");
    if (/\b(?:FAIL|failed)\b/.test(line) && /\b(?:test|spec|vitest|jest|playwright)\b/i.test(line)) results.add("Test failure");
    if (/\b(?:prisma|migration)\b/i.test(line) && /\b(?:error|failed)\b/i.test(line)) results.add("Database migration error");
    const file = /(?:^|\s)((?:src|app|pages|components|lib|tests|docs)\/[A-Za-z0-9_./\[\]-]+\.(?:ts|tsx|js|jsx|css|md|json))(?::\d+)?/.exec(line);
    if (file) { const parsed = safePath.safeParse(file[1]); if (parsed.success) results.add(`File ${parsed.data}`); }
    if (results.size >= 16) break;
  }
  return [...results];
}

type TreeFile = { path: string; type: string; mode: string; size?: number };
export function selectContextPaths(tree: TreeFile[], task: string, limit = 10): TreeFile[] {
  const words = [...new Set(task.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !["task", "with", "from", "that", "this", "create", "build", "update", "existing", "file", "test"].includes(word)))].slice(0, 20);
  const candidates = tree.filter(item => item.type === "blob" && item.mode === "100644" && item.size !== undefined && item.size <= 12_000 && (/^(?:README\.md|package\.json|tsconfig\.json|next\.config\.(?:ts|js)|vite\.config\.(?:ts|js)|vitest\.config\.(?:ts|js))$/.test(item.path) || safePath.safeParse(item.path).success));
  const score = (path: string) => {
    const lower = path.toLowerCase();
    const stem = lower.split("/").at(-1)?.replace(/\.(?:test|spec)?\.(?:tsx?|jsx?)$/, "") ?? "";
    return words.reduce((sum, word) => sum + (stem.includes(word) ? 16 : lower.includes(word) ? 8 : 0), 0)
      + (/\.(?:test|spec)\.[jt]sx?$/.test(lower) || lower.includes("/__tests__/") ? 3 : 0)
      + (lower === "package.json" ? 3 : 0)
      + (lower === "tsconfig.json" || lower.startsWith("next.config.") ? 2 : 0);
  };
  return candidates.sort((a, b) => score(b.path) - score(a.path) || a.path.localeCompare(b.path)).slice(0, limit);
}

export class GitHubDeveloperClient implements DeveloperGitHub {
  constructor(private readonly token: string) {}

  private async request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method, headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
        body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new DeveloperGitHubError("GitHub is temporarily unavailable. Retry this step."); }
    if (response.status === 401) throw new DeveloperGitHubError("GitHub authorization expired. Sign in again.");
    if (response.status === 403) throw new DeveloperGitHubError("GitHub denied this operation. Check repository permissions and branch protection.");
    if (response.status === 404) throw new DeveloperGitHubError("GitHub repository or resource was not found, or access was denied.");
    if (!response.ok) throw new DeveloperGitHubError(`GitHub operation failed (${response.status}). Check GitHub and retry.`);
    return response.json().catch(() => { throw new DeveloperGitHubError("GitHub returned an invalid response."); });
  }

  async repository(fullName: string) { return repoSchema.parse(await this.request(repoPath(fullName))); }
  async ref(fullName: string, branch: string) {
    safeTarget(branch);
    const path = `${repoPath(fullName)}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
    try { return refSchema.parse(await this.request(path)).object.sha; }
    catch (error) { if (error instanceof DeveloperGitHubError && error.message.includes("not found")) return null; throw error; }
  }
  async context(fullName: string, sha: string, task: string) {
    const root = repoPath(fullName);
    const commit = commitSchema.parse(await this.request(`${root}/git/commits/${shaSchema.parse(sha)}`));
    const tree = z.object({ truncated: z.boolean().optional(), tree: z.array(z.object({ path: z.string(), type: z.string(), mode: z.string(), size: z.number().optional() })).max(5000) }).parse(await this.request(`${root}/git/trees/${commit.tree.sha}?recursive=1`));
    if (tree.truncated) throw new RepositoryValidationError("GitHub truncated the repository tree; Forge cannot inspect it safely.");
    if (tree.tree.length > 500) throw new RepositoryValidationError("Repository tree has more than 500 entries; Forge cannot inspect it safely.");
    const paths = tree.tree.map(item => item.path).filter(path => safePath.safeParse(path).success);
    const selected = selectContextPaths(tree.tree, task).slice(0, 6);
    const candidates = new Map(selectContextPaths(tree.tree, task, 500).map(item => [item.path, item]));
    const files: { path: string; content: string }[] = [];
    let totalBytes = 0;
    const read = async (item: TreeFile) => {
      const raw = z.object({ content: z.string(), encoding: z.literal("base64") }).parse(await this.request(`${root}/contents/${item.path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`));
      const content = Buffer.from(raw.content.replace(/\s/g, ""), "base64").toString("utf8");
      const bytes = Buffer.byteLength(content);
      if (bytes <= 12_000 && totalBytes + bytes <= 64_000 && !/[\u0000-\u0008\u000e-\u001f]/.test(content) && !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:API_KEY|SECRET|PASSWORD|DATABASE_URL|AUTH_TOKEN)\s*[:=]\s*["']?[^\s"']{8,}/i.test(content)) { files.push({ path: item.path, content }); totalBytes += bytes; }
    };
    for (const item of selected) await read(item);
    const related = new Set<string>();
    for (const file of files) {
      for (const match of file.content.matchAll(/\b(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+)["']/g)) {
        const base = posix.normalize(posix.join(posix.dirname(file.path), match[1]));
        for (const suffix of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
          const candidate = `${base}${suffix}`;
          if (safePath.safeParse(candidate).success && candidates.has(candidate)) related.add(candidate);
        }
      }
      const stem = file.path.replace(/\.(?:test|spec)?\.[jt]sx?$/, "");
      for (const suffix of [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"]) if (candidates.has(`${stem}${suffix}`)) related.add(`${stem}${suffix}`);
    }
    for (const path of related) { if (files.length >= 10) break; const item = candidates.get(path); if (item && !selected.some(source => source.path === path)) await read(item); }
    for (const item of selectContextPaths(tree.tree, task)) { if (files.length >= 10) break; if (!selected.some(source => source.path === item.path) && !files.some(file => file.path === item.path)) await read(item); }
    return { paths, files };
  }
  async createBranch(fullName: string, branch: string, sha: string) {
    branchSchema.parse(branch);
    await this.request(`${repoPath(fullName)}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: shaSchema.parse(sha) });
  }
  async createCommit(fullName: string, parentSha: string, proposal: DeveloperProposal) {
    const root = repoPath(fullName);
    const parent = commitSchema.parse(await this.request(`${root}/git/commits/${shaSchema.parse(parentSha)}`));
    const tree = z.object({ sha: shaSchema }).parse(await this.request(`${root}/git/trees`, "POST", { base_tree: parent.tree.sha, tree: proposal.files.map(file => ({ path: file.path, mode: "100644", type: "blob", content: file.content })) }));
    const commit = z.object({ sha: shaSchema }).parse(await this.request(`${root}/git/commits`, "POST", { message: proposal.commitMessage, tree: tree.sha, parents: [parentSha], author: { name: "Forge AI Developer", email: "forge-ai[bot]@users.noreply.github.com" } }));
    return commit.sha;
  }
  async updateBranch(fullName: string, branch: string, sha: string) {
    branchSchema.parse(branch);
    await this.request(`${repoPath(fullName)}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, "PATCH", { sha: shaSchema.parse(sha), force: false });
  }
  async findPull(fullName: string, branch: string) {
    branchSchema.parse(branch);
    const owner = fullName.split("/")[0];
    const pulls = z.array(pullSchema).parse(await this.request(`${repoPath(fullName)}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=20`));
    return pulls.find(pull => pull.head.ref === branch && pull.head.repo.id === pull.base.repo.id) ?? null;
  }
  async createPull(fullName: string, branch: string, target: string, proposal: DeveloperProposal) {
    branchSchema.parse(branch); safeTarget(target);
    return pullSchema.parse(await this.request(`${repoPath(fullName)}/pulls`, "POST", { title: proposal.commitMessage, head: branch, base: target, body: `## Forge AI proposal\n${proposal.summary}\n\n## Validation plan\n${proposal.validationPlan}\n\n## Risks\n${proposal.risks}\n\nGenerated by Forge AI after explicit approval. Review the complete diff and CI results before merging.` }));
  }
  async pull(fullName: string, number: number) { return pullSchema.parse(await this.request(`${repoPath(fullName)}/pulls/${number}`)); }
  async checks(fullName: string, sha: string) {
    const root = repoPath(fullName); shaSchema.parse(sha);
    const runs = z.object({ total_count: z.number(), check_runs: z.array(z.object({ status: z.string(), conclusion: z.string().nullable() })) }).parse(await this.request(`${root}/commits/${sha}/check-runs?per_page=100`));
    const statuses = z.object({ state: z.string(), total_count: z.number() }).parse(await this.request(`${root}/commits/${sha}/status`));
    const count = runs.total_count + statuses.total_count;
    const passed = count > 0 && runs.total_count <= 100 && runs.check_runs.every(run => run.status === "completed" && ["success", "neutral", "skipped"].includes(run.conclusion ?? "")) && (statuses.total_count === 0 || statuses.state === "success");
    return { passed, summary: count === 0 ? "No remote checks are configured; merge is blocked." : passed ? `${count} GitHub check/status results passed.` : "GitHub checks are pending or failing; merge is blocked." };
  }
  async ciSnapshot(fullName: string, sha: string): Promise<CiSnapshot> {
    const root = repoPath(fullName); shaSchema.parse(sha);
    const runs = z.object({ total_count: z.number(), check_runs: z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() })) }).parse(await this.request(`${root}/commits/${sha}/check-runs?per_page=100`));
    const statuses = z.object({ state: z.string(), total_count: z.number(), statuses: z.array(z.object({ context: z.string(), state: z.string() })) }).parse(await this.request(`${root}/commits/${sha}/status`));
    const checks = [
      ...runs.check_runs.slice(0, 100).map(run => ({ name: safeLabel(run.name), status: ["queued", "in_progress", "completed", "pending"].includes(run.status) ? run.status : "unknown", conclusion: run.conclusion && ["success", "failure", "cancelled", "timed_out", "action_required", "neutral", "skipped", "stale"].includes(run.conclusion) ? run.conclusion : null })),
      ...statuses.statuses.slice(0, 100).map(status => ({ name: safeLabel(status.context), status: "completed", conclusion: status.state === "success" ? "success" : status.state === "pending" ? null : "failure" })),
    ];
    const count = runs.total_count + statuses.total_count;
    const conclusions = checks.map(check => check.conclusion);
    const state: CiState = count === 0 || runs.total_count > 100 || statuses.total_count > 100 ? "UNAVAILABLE" :
      conclusions.some(value => value === "failure" || value === "timed_out" || value === "action_required" || value === "stale") ? "FAILURE" :
      conclusions.some(value => value === "cancelled") ? "CANCELLED" :
      checks.some(check => check.status === "unknown" || check.status === "completed" && check.conclusion === null) ? "UNAVAILABLE" :
      checks.some(check => check.status !== "completed" || check.conclusion === null) ? "PENDING" : "SUCCESS";
    const summary = state === "UNAVAILABLE" ? "No complete GitHub CI result is available for this commit." : `${count} GitHub check/status results: ${state.toLowerCase()}.`;
    return { state, summary, checks };
  }
  async ciFailure(fullName: string, sha: string): Promise<CiFailure> {
    const root = repoPath(fullName); shaSchema.parse(sha);
    const runs = z.object({ workflow_runs: z.array(z.object({ id: z.number().int().positive(), head_sha: shaSchema, conclusion: z.string().nullable(), name: z.string() })) }).parse(await this.request(`${root}/actions/runs?head_sha=${sha}&per_page=10`));
    const failed = runs.workflow_runs.filter(run => run.head_sha === sha && ["failure", "timed_out", "action_required"].includes(run.conclusion ?? "")).slice(0, 2);
    if (!failed.length) return { summary: "A GitHub check failed, but no matching failed Actions workflow was available.", job: "unavailable", step: "unavailable", diagnostics: [] };
    const run = failed[0];
    const jobs = z.object({ jobs: z.array(z.object({ id: z.number().int().positive(), name: z.string(), conclusion: z.string().nullable(), steps: z.array(z.object({ name: z.string(), conclusion: z.string().nullable() })).optional() })) }).parse(await this.request(`${root}/actions/runs/${run.id}/jobs?per_page=30`));
    const job = jobs.jobs.find(item => ["failure", "timed_out", "action_required"].includes(item.conclusion ?? ""));
    if (!job) return { summary: `Workflow ${safeLabel(run.name)} failed; failed job details were unavailable.`, job: "unavailable", step: "unavailable", diagnostics: [] };
    const step = job.steps?.find(item => ["failure", "timed_out", "action_required"].includes(item.conclusion ?? ""));
    const diagnostics = await this.failureDiagnostics(root, job.id);
    return { summary: `Workflow ${safeLabel(run.name)} failed in job ${safeLabel(job.name)}${step ? `, step ${safeLabel(step.name)}` : ""}.`, job: safeLabel(job.name), step: step ? safeLabel(step.name) : "unavailable", diagnostics };
  }
  private async failureDiagnostics(root: string, jobId: number): Promise<string[]> {
    // GitHub returns a short-lived signed URL. Do not forward the OAuth token to it.
    let response: Response;
    try { response = await fetch(`https://api.github.com${root}/actions/jobs/${jobId}/logs`, { redirect: "manual", headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) }); }
    catch { return []; }
    const location = response.headers.get("location");
    if (response.status !== 302 || !location) return [];
    let url: URL;
    try { url = new URL(location); } catch { return []; }
    if (url.protocol !== "https:" || !/(?:^|\.)(?:githubusercontent\.com|actions.githubusercontent.com|blob.core.windows.net)$/.test(url.hostname)) return [];
    try {
      const logResponse = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!logResponse.ok || !logResponse.body) return [];
      const reader = logResponse.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      while (size < 32_000) { const { value, done } = await reader.read(); if (done) break; const kept = value.slice(0, 32_000 - size); chunks.push(kept); size += kept.length; }
      await reader.cancel();
      return extractSafeDiagnostics(new TextDecoder().decode(Buffer.concat(chunks)));
    } catch { return []; }
  }
  async merge(fullName: string, number: number, sha: string) {
    const result = z.object({ merged: z.boolean() }).parse(await this.request(`${repoPath(fullName)}/pulls/${number}/merge`, "PUT", { sha: shaSchema.parse(sha), merge_method: "merge" }));
    if (!result.merged) throw new DeveloperGitHubError("GitHub did not merge the pull request.");
  }
}

export async function developerGitHub(userId: string): Promise<DeveloperGitHub> {
  const token = await githubToken(userId);
  if (!token) throw new DeveloperGitHubError("GitHub access is missing. Sign out and sign in with GitHub again.");
  return new GitHubDeveloperClient(token);
}
