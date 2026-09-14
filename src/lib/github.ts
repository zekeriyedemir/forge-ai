import { db } from "@/lib/db";

export type GitHubRepo = { id: number; full_name: string; html_url: string; default_branch: string; private: boolean };

export async function githubToken(userId: string) {
  const account = await db.account.findFirst({ where: { userId, provider: "github" }, select: { access_token: true } });
  return account?.access_token ?? null;
}

export async function listRepositories(userId: string): Promise<GitHubRepo[]> {
  const token = await githubToken(userId);
  if (!token) throw new Error("Connect GitHub to list repositories");
  const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return await response.json() as GitHubRepo[];
}
