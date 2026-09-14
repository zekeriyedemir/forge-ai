import { currentUserId, projectForUser } from "@/lib/access";
import { db } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!await projectForUser(id, userId)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const events = await db.agentEvent.findMany({ where: { run: { projectId: id }, ...(cursor ? { createdAt: { gt: new Date(cursor) } } : {}) }, orderBy: { createdAt: "asc" }, take: 100, include: { run: { select: { type: true, status: true } } } });
  return Response.json({ events, cursor: events.at(-1)?.createdAt.toISOString() ?? cursor });
}
