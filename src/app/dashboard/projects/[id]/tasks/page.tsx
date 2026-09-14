import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";
import { updateTask } from "@/app/actions";

export default async function Tasks({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const tasks = await db.task.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
  return <section><h2 className="text-2xl font-semibold">Tasks</h2><p className="mt-2 text-sm text-slate-400">Move work forward as evidence and implementation arrive.</p><div className="mt-6 space-y-3">{tasks.map(task => <article key={task.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#111824] p-5"><div><h3 className="font-semibold">{task.title}</h3><p className="mt-1 text-sm text-slate-400">{task.description}</p></div><form action={updateTask.bind(null,id,task.id)} className="flex gap-2"><select name="status" defaultValue={task.status} aria-label={`Status for ${task.title}`} className="rounded-lg border border-white/10 bg-[#0a101a] px-3 py-2 text-sm"><option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Done</option></select><button className="rounded-lg bg-orange-400 px-3 py-2 text-sm font-semibold text-slate-950">Save</button></form></article>)}{tasks.length===0 && <p className="rounded-2xl border border-dashed border-white/15 p-8 text-slate-500">No tasks yet. Run the agent workflow to create a plan.</p>}</div></section>;
}
