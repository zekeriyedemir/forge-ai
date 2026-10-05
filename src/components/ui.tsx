import Link from "next/link";
import { ArrowRight, FolderGit2, Zap } from "lucide-react";
import type { ReactNode } from "react";

export function Brand() {
  return <Link href="/" className="brand" aria-label="Forge AI home"><span className="brand-mark"><Zap size={22} fill="currentColor" strokeWidth={1.5}/></span><span>forge<span className="ml-1.5 font-medium text-[#7d7899]">AI</span></span></Link>;
}
export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "info" | "success" | "warning" | "danger" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function EmptyState({ title, description, href, action, icon }: { title: string; description: string; href?: string; action?: string; icon?: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-[#dce1f0] bg-white/60 px-6 py-10 text-center"><span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-[#e4defb] bg-[#f1eeff] text-[#6a59ce]">{icon ?? <FolderGit2 size={22}/>}</span><h3 className="mt-4 text-base font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">{description}</p>{href && action && <Link href={href} className="btn btn-secondary mt-5">{action}<ArrowRight size={15}/></Link>}</div>;
}
export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="eyebrow">{eyebrow}</p><h1 className="page-title">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">{description}</p></div>{action}</div>;
}
