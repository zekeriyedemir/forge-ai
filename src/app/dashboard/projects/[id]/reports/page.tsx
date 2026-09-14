import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";

export default async function Reports({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const reports = await db.report.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
  return <section><h2 className="text-2xl font-semibold">Reports</h2><p className="mt-2 text-sm text-slate-400">Structured outputs from your agent team.</p><div className="mt-6 space-y-4">{reports.map(report => <article key={report.id} className="rounded-2xl border border-white/10 bg-[#111824] p-6"><p className="text-xs uppercase tracking-[.2em] text-orange-400">{report.kind}</p><h3 className="mt-2 text-xl font-semibold">{report.title}</h3><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-300">{report.content}</p></article>)}{reports.length===0 && <p className="rounded-2xl border border-dashed border-white/15 p-8 text-slate-500">Reports appear after agents complete.</p>}</div></section>;
}
