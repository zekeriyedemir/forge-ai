import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/access";
import { db } from "@/lib/db";
import { LayoutDashboard, FolderKanban, Plug, Settings } from "lucide-react";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const userId = await currentUserId();
  if (!userId) redirect("/login");
  const projects = await db.project.findMany({ where: { workspace: { members: { some: { userId } } } }, orderBy: { createdAt: "desc" }, take: 8 });
  const navigation = [{ href: "/dashboard", icon: LayoutDashboard, label: "Overview" }, { href: "/dashboard/projects", icon: FolderKanban, label: "Projects" }, { href: "/dashboard/integrations", icon: Plug, label: "Integrations" }, { href: "/dashboard/settings", icon: Settings, label: "Settings" }];
  return <div className="min-h-screen bg-[#080c14] text-slate-100 lg:flex"><aside className="border-b border-white/10 bg-[#0e1420] p-6 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r"><Link href="/" className="text-xl font-black tracking-[.22em] text-orange-400">FORGE <span className="text-white">AI</span></Link><p className="mt-2 text-[10px] uppercase tracking-[.25em] text-slate-500">Command center</p><nav className="mt-10 grid grid-cols-2 gap-1 lg:grid-cols-1" aria-label="Main navigation">{navigation.map(({href,icon: Icon,label}) => <Link key={href} href={href} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-slate-400 hover:bg-white/5 hover:text-white"><Icon size={17}/>{label}</Link>)}</nav><div className="mt-9 hidden lg:block"><p className="px-3 text-[10px] font-bold uppercase tracking-[.2em] text-slate-600">Your projects</p><div className="mt-3 space-y-1">{projects.map(project => <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="block truncate rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white">{project.name}</Link>)}</div></div><div className="mt-8 rounded-xl border border-orange-400/20 bg-orange-400/5 p-4 text-xs leading-5 text-slate-400">{process.env.OPENAI_API_KEY ? "Live AI provider configured" : "Demo AI provider · generated examples, not verified research"}</div></aside><main className="min-w-0 flex-1 px-5 py-8 sm:px-10 lg:px-12">{children}</main></div>;
}
