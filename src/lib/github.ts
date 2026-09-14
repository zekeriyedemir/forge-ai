import { db } from "@/lib/db";

export type GitHubRepo = { id: number; full_name: string; html_url: string; default_branch: string; private: boolean };

export async function githubToken(userId: string) {
  const account = await db.account.findFirst({ where: { userId, provider: "github" }, select: { providerAccountId: true, access_token: true, refresh_token: true, expires_at: true } });
  if (!account?.access_token) return null;
  if (!account.expires_at || account.expires_at > Math.floor(Date.now() / 1000) + 60) return account.access_token;
  const clientId = process.env.AUTH_GITHUB_ID;
  const clientSecret = process.env.AUTH_GITHUB_SECRET;
  if (!account.refresh_token || !clientId || !clientSecret) throw new Error("GitHub authorization expired. Sign out and sign in again.");
  let response: Response;
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: account.refresh_token }),
      cache: "no-store",
    });
  } catch { throw new Error("GitHub authorization renewal is temporarily unavailable. Try again later."); }
  if (!response.ok) throw new Error("GitHub authorization could not be renewed. Sign out and sign in again.");
  const token = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number } | null;
  if (!token?.access_token || !token.refresh_token || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error("GitHub authorization could not be renewed. Sign out and sign in again.");
  await db.account.update({ where: { provider_providerAccountId: { provider: "github", providerAccountId: account.providerAccountId } }, data: { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: Math.floor(Date.now() / 1000) + token.expires_in } });
  return token.access_token;
}

export async function listRepositories(userId: string): Promise<GitHubRepo[]> {
  const token = await githubToken(userId);
  if (!token) throw new Error("Connect GitHub to list repositories");
  const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" });
  if (response.status === 401) throw new Error("GitHub authorization is no longer valid. Sign out and sign in again.");
  if (!response.ok) throw new Error(`GitHub repository request failed (${response.status}).`);
  return await response.json() as GitHubRepo[];
}
