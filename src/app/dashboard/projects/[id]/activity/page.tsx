import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";
import { Clock3, History } from "lucide-react";
import { EmptyState } from "@/components/ui";

export default async function Activity({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const events = await db.activityEvent.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 100 });
  return <section><h2 className="text-2xl font-semibold tracking-tight">Activity</h2><p className="mt-2 text-sm text-slate-500">The story of your project, one milestone at a time.</p><div className="mt-6 space-y-3">{events.map(event => <article key={event.id} className="panel flex items-start gap-4 p-5"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#f2eefb] text-[#9b87c1]"><History size={15}/></span><div className="min-w-0"><p className="text-sm leading-6 text-slate-600">{event.message}</p><p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500"><Clock3 size={11}/>{event.createdAt.toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</p></div></article>)}{events.length === 0 && <EmptyState title="Your project’s story starts here" description="Goal updates, agent runs, and development milestones will appear in this timeline." href={`/dashboard/projects/${id}`} action="Go to overview" icon={<History size={22}/>}/>}</div></section>;
}
