import Link from "next/link";
import { auth } from "@/auth";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/db";
import { RepositoryPicker } from "@/components/repository-picker";

export default async function Integrations() {
  const userId = await requireUser();
  const session = await auth();
  const [account, projects] = await Promise.all([db.account.findFirst({ where: { userId, provider: "github" }, select: { userId: true } }), db.project.findMany({ where: { workspace: { members: { some: { userId } } } }, include: { repositories: true } })]);
  return <section className="max-w-4xl"><p className="text-xs font-bold uppercase tracking-[.25em] text-orange-400">Connections</p><h1 className="mt-3 text-4xl font-bold">Integrations</h1><div className="mt-9 rounded-2xl border border-white/10 bg-[#111824] p-7"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">GitHub</h2><span className="text-xs text-slate-400">{account ? "Connected" : "Not connected"}</span></div><p className="mt-3 text-sm text-slate-400">Link a repository to a Forge project. Repository listing uses your GitHub OAuth token on the server.</p>{!account && <p className="mt-5 text-sm text-orange-400">{session ? "Your account needs GitHub authorization." : "Sign in with GitHub to link repositories. Demo sessions have no GitHub token."} <Link className="underline" href="/login">Go to login</Link></p>}{account && <RepositoryPicker projects={projects.map(project => ({ id: project.id, name: project.name }))}/>}</div>{account && projects.map(project => <div key={project.id} className="mt-4 rounded-2xl border border-white/10 bg-[#111824] p-6"><h3 className="font-semibold">{project.name}</h3>{project.repositories[0] ? <a href={project.repositories[0].url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-sm text-orange-400 underline">{project.repositories[0].fullName}</a> : <p className="mt-2 text-sm text-slate-500">No repository linked yet.</p>}</div>)}</section>;
}
