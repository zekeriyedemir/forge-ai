"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function WorkflowButton({ projectId }: { projectId: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState("");
  const router = useRouter();
  async function run() {
    setRunning(true); setError("");
    try {
      const start = await fetch(`/api/projects/${projectId}/workflow`, { method: "POST" });
      const data = await start.json();
      if (!start.ok) throw new Error(data.error);
      for (let i = 0; i < 5; i++) {
        const result = await fetch(`/api/projects/${projectId}/workflow`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowId: data.workflowId }) });
        const state = await result.json();
        if (!result.ok) throw new Error(state.error);
        setStep(`${state.runs.filter((item: { status: string }) => item.status === "COMPLETED").length} of 5 agents complete`);
        router.refresh();
        if (state.runs.every((item: { status: string }) => item.status === "COMPLETED")) break;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workflow failed"); }
    finally { setRunning(false); router.refresh(); }
  }
  return <div className="flex flex-col items-start gap-2"><button onClick={run} disabled={running} className="rounded-xl bg-orange-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-orange-300 disabled:opacity-50">{running ? "Forge is working…" : "Run Forge workflow →"}</button>{step && <span className="text-sm text-slate-400" aria-live="polite">{step}</span>}{error && <span className="text-sm text-red-400" role="alert">{error}</span>}</div>;
}
