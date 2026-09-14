import { NextResponse } from "next/server";
import { currentUserId, projectForUser } from "@/lib/access";
import { advanceWorkflow, startWorkflow } from "@/lib/agents/runtime";
import { db } from "@/lib/db";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await projectForUser(id, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const recent = await db.agentRun.count({ where: { projectId: id, type: "FOUNDER", step: 0, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
  if (recent >= 5) return NextResponse.json({ error: "Workflow limit reached. Try again later." }, { status: 429 });
  try {
    const workflowId = await startWorkflow(id);
    return NextResponse.json({ workflowId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Workflow failed" }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await projectForUser(id, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { workflowId?: string };
  if (!body.workflowId || !/^[0-9a-f-]{36}$/.test(body.workflowId)) return NextResponse.json({ error: "Invalid workflow ID" }, { status: 400 });
  const exists = await db.agentRun.findFirst({ where: { projectId: id, workflowId: body.workflowId } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await advanceWorkflow(id, body.workflowId);
    const runs = await db.agentRun.findMany({ where: { projectId: id, workflowId: body.workflowId }, orderBy: { step: "asc" }, select: { id: true, type: true, status: true, error: true } });
    return NextResponse.json({ runs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Agent failed" }, { status: 500 });
  }
}
