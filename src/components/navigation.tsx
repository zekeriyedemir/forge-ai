"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, LayoutDashboard, Plug, Settings } from "lucide-react";
const navigation = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { href: "/dashboard/projects", icon: FolderKanban, label: "Projects" },
  { href: "/dashboard/integrations", icon: Plug, label: "Integrations" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];
export function DashboardNavigation() {
  const pathname = usePathname();
  return <nav className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1" aria-label="Main navigation">{navigation.map(({ href, icon: Icon, label }) => <Link key={href} href={href} className="nav-link" aria-current={(href === "/dashboard" ? pathname === href : pathname.startsWith(href)) ? "page" : undefined}><Icon size={17}/>{label}</Link>)}</nav>;
}
export function ProjectNavigation({ id, canDelete }: { id: string; canDelete: boolean }) {
  const pathname = usePathname();
  const tabs = [{ slug: "", label: "Overview" }, { slug: "/agents", label: "Agents" }, { slug: "/research", label: "Research" }, { slug: "/tasks", label: "Tasks" }, { slug: "/reports", label: "Reports" }, { slug: "/metrics", label: "Metrics" }, { slug: "/activity", label: "Activity" }, ...(canDelete ? [{ slug: "/approvals", label: "Approval Center" }, { slug: "/settings", label: "Settings" }] : [])];
  return <nav className="mt-7 flex overflow-x-auto border-b border-[#e1e6f1]" aria-label="Project navigation">{tabs.map(tab => <Link key={tab.slug} href={`/dashboard/projects/${id}${tab.slug}`} className="project-tab" aria-current={pathname === `/dashboard/projects/${id}${tab.slug}` ? "page" : undefined}>{tab.label}</Link>)}</nav>;
}
