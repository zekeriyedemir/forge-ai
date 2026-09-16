import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";
import Link from "next/link";

export default async function Agents({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const [runs, executions] = await Promise.all([
    db.agentRun.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, include: { events: { orderBy: { createdAt: "asc" } } } }),
    db.developerExecution.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return <section><h2 className="text-2xl font-semibold">Agent executions</h2><p className="mt-2 text-sm text-slate-400">Every step has a persisted run, status, and event history.</p><div className="mt-6 space-y-4">{executions.map(execution => <article key={execution.id} className="rounded-2xl border border-orange-400/20 bg-[#111824] p-6"><div className="flex justify-between gap-3"><h3 className="font-semibold">Developer repository work</h3><span className="text-xs text-orange-400">{execution.status}</span></div><p className="mt-2 text-sm text-slate-400">{execution.branch} → {execution.targetBranch}</p><p className="mt-2 text-sm text-slate-400">{execution.validationSummary}</p>{execution.error && <p className="mt-2 text-sm text-red-300">{execution.error}</p>}<Link className="mt-3 inline-block text-sm text-orange-300 underline" href={`/dashboard/projects/${id}/approvals`}>Review approvals and PR</Link></article>)}{runs.map(run => <article key={run.id} className="rounded-2xl border border-white/10 bg-[#111824] p-6"><div className="flex justify-between"><h3 className="font-semibold capitalize">{run.type.toLowerCase()} Agent</h3><span className="text-xs text-orange-400">{run.status}</span></div><p className="mt-2 text-xs text-slate-500">Execution {run.id} · {run.provider ?? "pending"} / {run.model ?? "—"}</p>{run.error && <p className="mt-3 text-sm text-red-400">{run.error}</p>}<div className="mt-5 space-y-3">{run.events.map(event => <p key={event.id} className="border-l border-orange-400/40 pl-4 text-sm text-slate-300">{event.message}</p>)}</div></article>)}{runs.length===0 && executions.length===0 && <p className="rounded-2xl border border-dashed border-white/15 p-8 text-slate-500">No executions yet. Start the workflow from Overview.</p>}</div></section>;
}
