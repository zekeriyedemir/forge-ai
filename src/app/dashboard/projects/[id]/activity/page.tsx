import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";

export default async function Activity({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const events = await db.activityEvent.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 100 });
  return <section><h2 className="text-2xl font-semibold">Activity</h2><p className="mt-2 text-sm text-slate-400">A persistent history of project and agent events.</p><div className="mt-6 space-y-3">{events.map(event => <article key={event.id} className="rounded-xl border border-white/10 bg-[#111824] p-5"><p className="text-sm">{event.message}</p><p className="mt-2 text-xs text-slate-500">{event.createdAt.toLocaleString()}</p></article>)}</div></section>;
}
