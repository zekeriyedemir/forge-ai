import { z } from "zod";
import { githubToken } from "@/lib/github";
import { branchSchema, safeTarget, shaSchema, type DeveloperProposal } from "./contracts";

const repoSchema = z.object({ id: z.number().int().positive(), full_name: z.string(), default_branch: z.string(), permissions: z.object({ push: z.boolean() }).optional() });
const refSchema = z.object({ object: z.object({ sha: shaSchema }) });
const commitSchema = z.object({ sha: shaSchema, tree: z.object({ sha: shaSchema }) });
const pullSchema = z.object({ number: z.number().int().positive(), html_url: z.url().refine(url => new URL(url).origin === "https://github.com"), state: z.string(), mergeable: z.boolean().nullable().optional(), merged: z.boolean().optional(), head: z.object({ sha: shaSchema, ref: z.string(), repo: z.object({ id: z.number() }) }), base: z.object({ ref: z.string(), repo: z.object({ id: z.number() }) }) });

export class DeveloperGitHubError extends Error {}
export type RepoInfo = z.infer<typeof repoSchema>;
export type PullInfo = z.infer<typeof pullSchema>;

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
  merge(fullName: string, number: number, sha: string): Promise<void>;
}

function repoPath(fullName: string) {
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new DeveloperGitHubError("Invalid linked repository");
  return `/repos/${parts.map(encodeURIComponent).join("/")}`;
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
    if (tree.truncated) throw new DeveloperGitHubError("Repository tree is too large to inspect safely.");
    const paths = tree.tree.map(item => item.path);
    if (paths.length > 500) throw new DeveloperGitHubError("Repository contains more than 500 files; this bounded Developer workflow cannot inspect it safely.");
    const words = task.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !["task", "with", "from", "that", "this", "create", "build"].includes(word));
    const selected = tree.tree.filter(item => item.type === "blob" && item.mode === "100644" && item.size !== undefined && item.size <= 12_000 && /^(?:README\.md|package\.json|(?:src|app|pages|components|lib|tests)\/.+\.(?:ts|tsx|js|jsx|css|md|json))$/.test(item.path))
      .sort((a, b) => {
        const score = (path: string) => words.reduce((sum, word) => sum + (path.toLowerCase().includes(word) ? 10 : 0), 0) + (/^(README\.md|package\.json)$/.test(path) ? 2 : 0);
        return score(b.path) - score(a.path) || a.path.localeCompare(b.path);
      }).slice(0, 8);
    const files: { path: string; content: string }[] = [];
    for (const item of selected) {
      const raw = z.object({ content: z.string(), encoding: z.literal("base64") }).parse(await this.request(`${root}/contents/${item.path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`));
      const content = Buffer.from(raw.content.replace(/\s/g, ""), "base64").toString("utf8");
      if (!/[\u0000-\u0008\u000e-\u001f]/.test(content) && !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}/.test(content)) files.push({ path: item.path, content });
    }
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
