import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId, projectForOwner } from "@/lib/access";
import { GitHubIntegrationError, listRepositories } from "@/lib/github";
import { db } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const project = await projectForOwner(id, userId);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = z.object({ repositoryId: z.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid repository" }, { status: 400 });
  try {
    const repo = (await listRepositories(userId)).find(item => item.id === parsed.data.repositoryId);
    if (!repo) return NextResponse.json({ error: "Repository not available" }, { status: 404 });
    await db.gitHubRepository.upsert({ where: { projectId: id }, create: { projectId: id, githubId: BigInt(repo.id), fullName: repo.full_name, url: repo.html_url, defaultBranch: repo.default_branch }, update: { githubId: BigInt(repo.id), fullName: repo.full_name, url: repo.html_url, defaultBranch: repo.default_branch } });
    await db.integration.upsert({ where: { workspaceId_type: { workspaceId: project.workspaceId, type: "GITHUB" } }, create: { workspaceId: project.workspaceId, type: "GITHUB" }, update: { status: "CONNECTED" } });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof GitHubIntegrationError ? error.message : "Could not link the GitHub repository. Try again." }, { status: 502 }); }
}
