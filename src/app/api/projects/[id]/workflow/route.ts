import { NextResponse } from "next/server";
import { currentUserId, projectForOwner } from "@/lib/access";
import { advanceWorkflow, startWorkflow } from "@/lib/agents/runtime";
import { db } from "@/lib/db";
import { z } from "zod";

export const maxDuration = 120;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await projectForOwner(id, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const recent = await db.agentRun.count({ where: { projectId: id, type: "FOUNDER", step: 0, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
  if (recent >= 5) return NextResponse.json({ error: "Workflow limit reached. Try again later." }, { status: 429 });
  try {
    const workflowId = await startWorkflow(id);
    return NextResponse.json({ workflowId });
  } catch (error) {
    if (error instanceof Error && error.message === "Add a business goal before starting the workflow") return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Failed to start Forge workflow", error);
    return NextResponse.json({ error: "Could not start workflow. Please retry." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await projectForOwner(id, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = z.object({ workflowId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid workflow ID" }, { status: 400 });
  const { workflowId } = parsed.data;
  const exists = await db.agentRun.findFirst({ where: { projectId: id, workflowId } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await advanceWorkflow(id, workflowId);
    const runs = await db.agentRun.findMany({ where: { projectId: id, workflowId }, orderBy: { step: "asc" }, select: { id: true, type: true, status: true, error: true } });
    return NextResponse.json({ runs });
  } catch (error) {
    console.error("Failed to advance Forge workflow", { reason: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Agent execution failed. Check activity for details." }, { status: 500 });
  }
}
