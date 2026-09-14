import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/access";
import { listRepositories } from "@/lib/github";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ repositories: await listRepositories(userId) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub unavailable" }, { status: 502 }); }
}
