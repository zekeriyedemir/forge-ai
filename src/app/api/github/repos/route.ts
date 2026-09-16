import { NextResponse } from "next/server";
import { authenticatedUserId } from "@/lib/access";
import { GitHubIntegrationError, listRepositories } from "@/lib/github";

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Sign in with GitHub to list repositories." }, { status: 401 });
  try { return NextResponse.json({ repositories: await listRepositories(userId) }); }
  catch (error) { return NextResponse.json({ error: error instanceof GitHubIntegrationError ? error.message : "Could not load GitHub repositories. Try again." }, { status: 502 }); }
}
