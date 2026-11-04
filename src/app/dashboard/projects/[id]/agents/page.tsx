import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";
import Link from "next/link";
import { ArrowRight, Bot, GitBranch } from "lucide-react";
import { EmptyState, StatusBadge } from "@/components/ui";
import { runPresentation } from "@/lib/agents/workflow-status";

export default async function Agents({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const [runs, executions] = await Promise.all([
    db.agentRun.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, include: { events: { orderBy: { createdAt: "asc" } } } }),
    db.developerExecution.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const workflows = new Map<string, typeof runs>();
  for (const run of runs) {
    const workflow = workflows.get(run.workflowId) ?? [];
    workflow.push(run);
    workflows.set(run.workflowId, workflow);
  }
  const orderedWorkflows = [...workflows.entries()].map(([workflowId, steps]) => ({ workflowId, steps: steps.sort((a, b) => a.step - b.step) }));

  return <section>
    <h2 className="text-2xl font-semibold tracking-tight">Agent executions</h2>
    <p className="mt-2 text-sm text-slate-500">Workflows appear newest first, with each agent shown in execution order.</p>
    <div className="mt-6 space-y-6">
      {executions.map(execution => <article key={execution.id} className="panel border-[#e3daf7] p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><GitBranch size={17} className="text-[#8d76bb]"/>Developer repository work</h3><StatusBadge tone={execution.status === "FAILED" ? "danger" : "info"}>{execution.status.toLowerCase().replaceAll("_", " ")}</StatusBadge></div><p className="mt-3 text-xs text-slate-500">{execution.branch} → {execution.targetBranch}</p><p className="mt-2 text-sm leading-6 text-slate-500">{execution.validationSummary}</p>{execution.error && <p className="notice notice-error mt-3">This execution needs attention. Review its status and proposed changes in the Approval Center.</p>}<Link className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-[#8167b1]" href={`/dashboard/projects/${id}/approvals`}>Review approvals and PR<ArrowRight size={13}/></Link></article>)}
      {orderedWorkflows.map(({ workflowId, steps }, index) => <section key={workflowId} aria-labelledby={`workflow-${workflowId}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id={`workflow-${workflowId}`} className="text-sm font-semibold">{index === 0 ? "Latest workflow" : "Earlier workflow"}</h3>
          <time dateTime={steps[0].createdAt.toISOString()} className="text-[11px] text-slate-500">{steps[0].createdAt.toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time>
        </div>
        <div className="space-y-3">{steps.map(run => {
          const presentation = runPresentation(run);
          const providerLabel = presentation.status === "SKIPPED" ? "Not started" : run.provider ?? (run.status === "FAILED" ? "Stopped during execution" : run.status === "RUNNING" ? "In progress" : run.status === "COMPLETED" ? "Completed" : "Queued");
          return <article key={run.id} className="panel p-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="flex items-center gap-2 text-sm font-semibold capitalize"><span className="grid size-6 place-items-center rounded-full bg-[#f1eff9] text-[11px] text-[#8167b1]">{run.step + 1}</span><Bot size={17} className="text-[#8e79b8]"/>{run.type.toLowerCase()} Agent</h4><StatusBadge tone={presentation.status === "COMPLETED" ? "success" : presentation.status === "FAILED" ? "danger" : presentation.status === "SKIPPED" ? "neutral" : "warning"}>{presentation.label}</StatusBadge></div>
            <p className="mt-3 text-[11px] text-slate-500">{providerLabel}{run.model ? ` · ${run.model}` : ""}</p>
            {presentation.message && <p className={`mt-3 ${presentation.status === "FAILED" ? "notice notice-error" : "text-xs leading-6 text-slate-500"}`}>{presentation.message}</p>}
            {run.events.some(event => event.kind !== "failed") && <div className="mt-5 space-y-3">{run.events.filter(event => event.kind !== "failed").map(event => <p key={event.id} className="border-l-2 border-[#e0d5f1] pl-4 text-xs leading-6 text-slate-600">{event.message}</p>)}</div>}
          </article>;
        })}</div>
      </section>)}
      {runs.length === 0 && executions.length === 0 && <EmptyState title="Your AI team is ready to begin" description="Start your workflow to see strategy, research, development, and analysis come together." href={`/dashboard/projects/${id}`} action="Go to overview" icon={<Bot size={22}/>}/>}
    </div>
  </section>;
}
