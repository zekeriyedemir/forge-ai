import { notFound, redirect } from "next/navigation";
import { deleteProject } from "@/app/actions";
import { DeleteProjectForm } from "@/components/delete-project-form";
import { authenticatedUserId, projectForOwner } from "@/lib/access";
import { Trash2 } from "lucide-react";

export default async function ProjectSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await authenticatedUserId();
  if (!userId) redirect("/login");
  const project = await projectForOwner(id, userId);
  if (!project) notFound();
  return <section className="panel max-w-2xl border-rose-200 p-7"><span className="mb-5 grid size-11 place-items-center rounded-xl bg-rose-50 text-rose-500"><Trash2 size={20}/></span><p className="text-[11px] font-semibold uppercase tracking-[.15em] text-rose-600">Danger zone</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">Delete project</h2><p className="mt-3 text-sm leading-6 text-slate-500">This permanently deletes the project and its goals, workflows, tasks, reports, metrics, activity, and repository connection. Your GitHub repository itself is kept. This action cannot be undone.</p><DeleteProjectForm projectName={project.name} action={deleteProject.bind(null, id)}/></section>;
}
