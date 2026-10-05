"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, LoaderCircle, Sparkles } from "lucide-react";

type WorkflowRun = { status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; type: string };
function workflowRuns(value: unknown): WorkflowRun[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every(item => item && typeof item === "object" && typeof item.type === "string" && ["PENDING", "RUNNING", "COMPLETED", "FAILED"].includes(item.status)) ? value as WorkflowRun[] : null;
}

export function WorkflowButton({ projectId }: { projectId: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [finished, setFinished] = useState(false);
  const [hasWorkflow, setHasWorkflow] = useState(false);
  const activeRequest = useRef(false);
  const workflowId = useRef<string | null>(null);
  const router = useRouter();

  async function run() {
    if (activeRequest.current) return;
    activeRequest.current = true;
    setRunning(true); setError(""); setFinished(false); setRuns([]);
    try {
      if (!workflowId.current) {
        const start = await fetch(`/api/projects/${projectId}/workflow`, { method: "POST", signal: AbortSignal.timeout(125_000) });
        const data = await start.json().catch(() => null);
        if (!start.ok) throw new Error(start.status === 429 ? "Your workspace is busy. Wait for the current workflow, then try again." : start.status === 401 || start.status === 404 ? "Sign in with an account that owns this project to run its workflow." : "We couldn’t start your workflow. Check that this project has a goal, then try again.");
        if (!data || typeof data.workflowId !== "string" || !data.workflowId) throw new Error("We couldn’t confirm the workflow started. Refresh the project before trying again.");
        workflowId.current = data.workflowId;
        setHasWorkflow(true);
      }
      const deadline = Date.now() + 10 * 60_000;
      for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
        const result = await fetch(`/api/projects/${projectId}/workflow`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowId: workflowId.current }), signal: AbortSignal.timeout(125_000) });
        const state = await result.json().catch(() => null);
        if (!result.ok) throw new Error("We lost the workflow connection. Try again to continue this run.");
        const nextRuns = workflowRuns(state?.runs);
        if (!nextRuns) throw new Error("We couldn’t read the workflow status. Try again to check this run.");
        setRuns(nextRuns);
        router.refresh();
        if (nextRuns.some(item => item.status === "FAILED")) {
          workflowId.current = null;
          setHasWorkflow(false);
          throw new Error("An agent couldn’t complete its work. Review the agent history, then try the workflow again.");
        }
        if (nextRuns.every(item => item.status === "COMPLETED")) {
          workflowId.current = null;
          setHasWorkflow(false);
          setFinished(true);
          return;
        }
        // A request can observe a run claimed by another worker. Keep checking
        // real server state instead of assuming one request completes one agent.
        if (nextRuns.some(item => item.status === "RUNNING")) await new Promise(resolve => setTimeout(resolve, 1500));
      }
      setError("This workflow is taking longer than expected. Check again to continue following the same run.");
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "Error" ? cause.message : "The connection was interrupted. Try again to check your workflow.");
    } finally {
      activeRequest.current = false; setRunning(false); router.refresh();
    }
  }
  const complete = runs.filter(item => item.status === "COMPLETED").length;
  const current = runs.find(item => item.status === "RUNNING" || item.status === "PENDING");
  return <div className="flex flex-col items-start gap-3"><button type="button" onClick={run} disabled={running} className="btn btn-primary">{running ? <LoaderCircle size={16} className="animate-spin"/> : <Sparkles size={16}/>} {running ? "Forge is working…" : hasWorkflow ? "Check workflow again" : "Run Forge workflow"}{!running && <ArrowRight size={15}/>}</button>{running && <p role="status" className="text-xs text-[#7b6a96]">{current ? `${current.type.charAt(0)}${current.type.slice(1).toLowerCase()} agent is processing your goal…` : "Starting your workflow…"}</p>}{runs.length > 0 && <div className="w-full max-w-sm"><div className="mb-2 flex items-center justify-between gap-2 text-xs text-[#79678e]"><span aria-live="polite">{complete} of {runs.length} agents complete</span>{finished && <CheckCircle2 size={15} className="text-emerald-600"/>}</div><div className="h-1.5 overflow-hidden rounded-full bg-[#e6dff5]" role="progressbar" aria-label="Completed agents" aria-valuemin={0} aria-valuemax={runs.length} aria-valuenow={complete}><div className="h-full rounded-full bg-[#9080d2] transition-[width]" style={{ width: `${complete / runs.length * 100}%` }}/></div></div>}{finished && <p role="status" className="flex items-center gap-2 text-xs font-medium text-emerald-700"><CheckCircle2 size={15}/>Workflow completed. Your tasks and reports are ready.</p>}{error && <p className="notice notice-error w-full" role="alert"><AlertCircle size={17} className="shrink-0"/>{error}</p>}</div>;
}
