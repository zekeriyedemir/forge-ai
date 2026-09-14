import Link from "next/link";
import { notFound } from "next/navigation";
import { projectForUser, requireUser } from "@/lib/access";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUser();
  const project = await projectForUser(id, userId);
  if (!project) notFound();
  const tabs = [{ slug: "", label: "Overview" }, { slug: "/agents", label: "Agents" }, { slug: "/tasks", label: "Tasks" }, { slug: "/reports", label: "Reports" }, { slug: "/metrics", label: "Metrics" }, { slug: "/activity", label: "Activity" }];
  return <div className="mx-auto max-w-6xl"><Link href="/dashboard/projects" className="text-sm text-slate-500 hover:text-white">← All projects</Link><p className="mt-8 text-xs font-bold uppercase tracking-[.25em] text-orange-400">Forge / Project</p><h1 className="mt-3 text-4xl font-bold">{project.name}</h1><p className="mt-3 max-w-3xl text-slate-400">{project.description || "Your business command center"}</p><nav className="mt-9 flex gap-2 overflow-x-auto border-b border-white/10 pb-3" aria-label="Project navigation">{tabs.map(tab => <Link key={tab.slug} href={`/dashboard/projects/${id}${tab.slug}`} className="whitespace-nowrap rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white">{tab.label}</Link>)}</nav><div className="py-8">{children}</div></div>;
}
