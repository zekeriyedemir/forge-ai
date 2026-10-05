import Link from "next/link";
import { notFound } from "next/navigation";
import { authenticatedUserId, projectForOwner, projectForUser, requireUser } from "@/lib/access";
import { ArrowLeft, FolderGit2 } from "lucide-react";
import { ProjectNavigation } from "@/components/navigation";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUser();
  const project = await projectForUser(id, userId);
  if (!project) notFound();
  const signedInUserId = await authenticatedUserId();
  const canDelete = signedInUserId === userId && Boolean(await projectForOwner(id, userId));
  return <div className="mx-auto max-w-6xl"><Link href="/dashboard/projects" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600"><ArrowLeft size={14}/>All projects</Link><div className="mt-7 flex items-start gap-4"><span className="mt-1 hidden size-12 shrink-0 items-center justify-center rounded-2xl border border-[#e3def7] bg-[#eee9fb] text-[#8770c7] sm:flex"><FolderGit2 size={25}/></span><div className="min-w-0"><p className="eyebrow">Your project workspace</p><h1 className="page-title break-words">{project.name}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">{project.description || "Give your ideas direction. Keep your next steps in view."}</p></div></div><ProjectNavigation id={id} canDelete={canDelete}/><div className="py-7">{children}</div></div>;
}
