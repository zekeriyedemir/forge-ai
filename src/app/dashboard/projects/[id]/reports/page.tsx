import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";
import { FileText } from "lucide-react";
import { EmptyState, StatusBadge } from "@/components/ui";

export default async function Reports({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const reports = await db.report.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
  return <section><h2 className="text-2xl font-semibold tracking-tight">Reports</h2><p className="mt-2 text-sm text-slate-500">Your agent team’s thinking, organized and ready to review.</p><div className="mt-6 space-y-5">{reports.map(report => <article key={report.id} className="panel overflow-hidden"><div className="border-b border-[#eceaf5] bg-gradient-to-r from-[#faf7ff] to-white p-6"><StatusBadge tone="info"><FileText size={12}/>{report.kind.replaceAll("_", " ")}</StatusBadge><h3 className="mt-3 text-xl font-semibold tracking-tight">{report.title}</h3></div><p className="whitespace-pre-wrap p-6 text-sm leading-7 text-slate-600">{report.content}</p></article>)}{reports.length === 0 && <EmptyState title="A place for your project insights" description="Your strategy, research, and development reports will appear here after the workflow runs." href={`/dashboard/projects/${id}`} action="Go to overview" icon={<FileText size={22}/>}/>}</div></section>;
}
