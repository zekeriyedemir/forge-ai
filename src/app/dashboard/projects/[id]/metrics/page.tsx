import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";
import { ChartNoAxesCombined } from "lucide-react";
import { EmptyState } from "@/components/ui";

export default async function Metrics({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const metrics = await db.metric.findMany({ where: { projectId: id }, orderBy: { label: "asc" } });
  return <section><h2 className="text-2xl font-semibold tracking-tight">Metrics</h2><p className="mt-2 text-sm text-slate-500">Track recorded project progress. Demo values start at zero.</p><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(metric => <article key={metric.id} className="panel p-6"><span className="mb-5 grid size-10 place-items-center rounded-xl bg-[#edf6fd] text-[#67a4bd]"><ChartNoAxesCombined size={20}/></span><p className="text-xs text-slate-500">{metric.label}</p><p className="mt-3 text-4xl font-bold tracking-tight">{metric.value}<span className="ml-1.5 text-base font-normal text-slate-500">{metric.unit}</span></p></article>)}</div>{metrics.length === 0 && <EmptyState title="Progress you can see" description="Metrics recorded by your workflow will appear here. Start with your project’s first run." href={`/dashboard/projects/${id}`} action="Go to overview" icon={<ChartNoAxesCombined size={22}/>}/>}</section>;
}
