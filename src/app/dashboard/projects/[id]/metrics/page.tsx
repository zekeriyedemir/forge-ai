import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";

export default async function Metrics({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const metrics = await db.metric.findMany({ where: { projectId: id }, orderBy: { label: "asc" } });
  return <section><h2 className="text-2xl font-semibold">Metrics</h2><p className="mt-2 text-sm text-slate-400">Track validated progress. Demo values start at zero.</p><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(metric => <article key={metric.id} className="rounded-2xl border border-white/10 bg-[#111824] p-6"><p className="text-sm text-slate-400">{metric.label}</p><p className="mt-3 text-4xl font-bold">{metric.value}<span className="ml-1 text-lg text-slate-500">{metric.unit}</span></p></article>)}</div>{metrics.length===0 && <p className="mt-6 rounded-2xl border border-dashed border-white/15 p-8 text-slate-500">No metrics recorded yet.</p>}</section>;
}
