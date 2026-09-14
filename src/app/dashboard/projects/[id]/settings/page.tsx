import { notFound, redirect } from "next/navigation";
import { deleteProject } from "@/app/actions";
import { DeleteProjectForm } from "@/components/delete-project-form";
import { authenticatedUserId, projectForOwner } from "@/lib/access";

export default async function ProjectSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await authenticatedUserId();
  if (!userId) redirect("/login");
  const project = await projectForOwner(id, userId);
  if (!project) notFound();
  return <section className="max-w-2xl rounded-2xl border border-red-400/20 bg-[#111824] p-7">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-red-300">Danger zone</p>
    <h2 className="mt-3 text-2xl font-semibold">Delete project</h2>
    <p className="mt-3 text-sm text-slate-400">This permanently deletes the project and its goals, workflows, tasks, reports, metrics, activity, and linked repository. This action cannot be undone.</p>
    <DeleteProjectForm projectName={project.name} action={deleteProject.bind(null, id)} />
  </section>;
}
