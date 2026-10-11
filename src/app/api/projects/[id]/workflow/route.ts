import { NextResponse } from "next/server";
import { currentUserId, projectForOwner } from "@/lib/access";
import { advanceWorkflow, startWorkflow, WorkflowLimitError, WorkflowPreflightError } from "@/lib/agents/runtime";
import { runFailure, runPresentation, SKIPPED_ERROR, workflowFailure } from "@/lib/agents/workflow-status";
import { db } from "@/lib/db";
import { z } from "zod";

export const maxDuration = 120;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  try {
    const userId = await currentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!await projectForOwner(id, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const workflowId = await startWorkflow(id);
    return NextResponse.json({ workflowId });
  } catch (error) {
    if (error instanceof Error && error.message === "Add a business goal before starting the workflow") return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof WorkflowLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof WorkflowPreflightError) {
      const failure = workflowFailure(error.code);
      return NextResponse.json({ error: failure.message, code: failure.code }, { status: 503 });
    }
    console.error("Failed to start Forge workflow", { projectId: id, code: "WORKFLOW_START_FAILED" });
    return NextResponse.json({ error: "Could not start workflow. Please retry." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  try {
    const userId = await currentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!await projectForOwner(id, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = z.object({ workflowId: z.uuid() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid workflow ID" }, { status: 400 });
    const { workflowId } = parsed.data;
    const exists = await db.agentRun.findFirst({ where: { projectId: id, workflowId } });
    if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let executionError: unknown;
    try { await advanceWorkflow(id, workflowId); }
    catch (error) { executionError = error; }
    const storedRuns = await db.agentRun.findMany({ where: { projectId: id, workflowId }, orderBy: { step: "asc" }, select: { id: true, type: true, status: true, error: true, events: { where: { kind: "failed" }, orderBy: { createdAt: "asc" }, select: { kind: true, data: true } } } });
    const failed = storedRuns.find(run => runPresentation(run).status === "FAILED");
    // A persisted agent failure is workflow state, not a lost HTTP connection.
    // If persistence itself failed, retain a retryable server error instead.
    if (executionError && !failed) throw executionError;
    const runs = storedRuns.map(run => ({ id: run.id, type: run.type, status: run.status,
      error: run.status === "FAILED" ? (runPresentation(run).status === "SKIPPED" ? SKIPPED_ERROR : runFailure(run).message) : null,
      ...(runPresentation(run).status === "FAILED" ? { errorCode: runFailure(run).code } : {}),
    }));
    return NextResponse.json({ runs, ...(failed ? { failure: runFailure(failed) } : {}) });
  } catch {
    console.error("Failed to advance Forge workflow", { projectId: id, code: "WORKFLOW_ADVANCE_FAILED" });
    return NextResponse.json({ error: "We couldn't complete this workflow. Please try again." }, { status: 500 });
  }
}
