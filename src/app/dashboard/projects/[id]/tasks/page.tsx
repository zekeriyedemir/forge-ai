import { requireProject } from "@/lib/access";
import { db } from "@/lib/db";
import { updateTask } from "@/app/actions";
import { CheckCheck, ListTodo } from "lucide-react";
import { EmptyState, StatusBadge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";

export default async function Tasks({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; await requireProject(id);
  const tasks = await db.task.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
  const done = tasks.filter(task => task.status === "DONE").length;
  return <section><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold tracking-tight">Tasks</h2><p className="mt-2 text-sm text-slate-500">A practical plan, one next step at a time.</p></div>{tasks.length > 0 && <StatusBadge tone="success"><CheckCheck size={13}/>{done} of {tasks.length} complete</StatusBadge>}</div><div className="mt-6 space-y-3">{tasks.map(task => <article key={task.id} className="panel p-5 sm:p-6"><div className="flex items-start gap-3"><span className={`mt-1 grid size-8 shrink-0 place-items-center rounded-lg ${task.status === "DONE" ? "bg-emerald-50 text-emerald-600" : "bg-[#f0edfb] text-[#907bc0]"}`}><ListTodo size={17}/></span><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold leading-6">{task.title}</h3><p className="mt-1 text-xs leading-6 text-slate-500">{task.description}</p><ActionForm action={updateTask.bind(null, id, task.id)} successMessage="Task status updated." className="mt-4 flex flex-wrap items-center gap-2"><select name="status" defaultValue={task.status} aria-label={`Status for ${task.title}`} className="field mt-0 w-auto min-w-36"><option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Done</option></select><SubmitButton className="btn btn-secondary" pendingLabel="Saving…">Save</SubmitButton></ActionForm></div></div></article>)}{tasks.length === 0 && <EmptyState title="Your next steps are taking shape" description="Run your project workflow to turn your goal into a practical task list." href={`/dashboard/projects/${id}`} action="Go to overview" icon={<ListTodo size={22}/>}/>}</div></section>;
}
