"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Check, CheckCircle2, ExternalLink, FolderGit2, Link2, LoaderCircle, LockKeyhole, Search } from "lucide-react";

type Repo = { id: number; full_name: string; html_url: string; private: boolean };
type Project = { id: string; name: string };

export function RepositoryPicker({ projects }: { projects: Project[] }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkError, setLinkError] = useState("");
  const [success, setSuccess] = useState("");
  const [linking, setLinking] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [query, setQuery] = useState("");
  const [requestKey, setRequestKey] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/github/repos", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in again with GitHub to load your repositories." : "We couldn’t load your repositories. Check your GitHub connection and try again.");
        if (!data || !Array.isArray(data.repositories) || !data.repositories.every((repo: Repo | null) => repo !== null && typeof repo === "object" && typeof repo.id === "number" && typeof repo.full_name === "string" && typeof repo.html_url === "string" && repo.html_url.startsWith("https://github.com/") && typeof repo.private === "boolean")) throw new Error("We couldn’t read your repository list. Please try again.");
        return data.repositories as Repo[];
      })
      .then(data => { setRepos(data); setError(""); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error && cause.name === "Error" ? cause.message : "Could not load GitHub repositories. Please try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestKey]);

  function retry() { setError(""); setLoading(true); setRequestKey(key => key + 1); }
  async function link(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject || !selectedRepo || linking) return;
    setLinkError(""); setSuccess(""); setLinking(true);
    try {
      const response = await fetch(`/api/projects/${selectedProject}/repository`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryId: Number(selectedRepo) }), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 404 ? "Sign in with the project owner’s GitHub account to link this repository." : "We couldn’t link this repository. Check your GitHub access and try again.");
      setSuccess(`${repos.find(repo => String(repo.id) === selectedRepo)?.full_name ?? "Repository"} linked to ${projects.find(project => project.id === selectedProject)?.name ?? "your project"}.`);
      router.refresh();
    } catch (cause) { setLinkError(cause instanceof Error && cause.name === "Error" ? cause.message : "Connection interrupted. Please try again."); }
    finally { setLinking(false); }
  }
  const filtered = repos.filter(repo => repo.full_name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="mt-6 border-t border-[#e9edf5] pt-6"><h3 className="text-sm font-semibold">Your repositories</h3>{loading && <div className="mt-4 space-y-3" role="status" aria-label="Loading your GitHub repositories"><span className="sr-only">Loading your GitHub repositories…</span>{[1, 2, 3].map(i => <div key={i} className="flex items-center gap-3 rounded-xl border border-[#edf0f7] p-3"><div className="skeleton size-8"/><div className="skeleton h-3 w-3/5"/></div>)}</div>}{!loading && error && <div role="alert" className="notice notice-error mt-4"><AlertCircle size={17} className="shrink-0"/><div><p>{error}</p><button type="button" onClick={retry} className="mt-2 font-semibold underline underline-offset-4">Try again</button></div></div>}{!loading && !error && <><p className="mt-2 text-xs leading-5 text-slate-500">{repos.length ? `${repos.length} repositories available to your GitHub authorization.` : "No repositories are available to this GitHub authorization. Check your repository permissions in GitHub, then refresh."}</p>{repos.length === 0 && <button type="button" onClick={retry} className="btn btn-secondary mt-4">Refresh repositories</button>}{repos.length > 0 && <><div className="relative mt-4"><Search size={16} className="absolute left-3.5 top-3.5 text-slate-400"/><input type="search" aria-label="Search repositories" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your repositories…" className="field pl-10"/></div><ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1" aria-label="GitHub repositories">{filtered.map(repo => <li key={repo.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${String(repo.id) === selectedRepo ? "border-[#cfc4ec] bg-[#f8f5ff]" : "border-[#edf0f7] bg-white"}`}><button type="button" onClick={() => { setSelectedRepo(String(repo.id)); setSuccess(""); }} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-pressed={String(repo.id) === selectedRepo}><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f2eef9] text-[#9277bf]">{String(repo.id) === selectedRepo ? <Check size={16}/> : <FolderGit2 size={17}/>}</span><span className="truncate text-xs font-medium">{repo.full_name}</span></button><span className="badge badge-neutral">{repo.private && <LockKeyhole size={10}/>} {repo.private ? "Private" : "Public"}</span><a href={repo.html_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${repo.full_name} on GitHub`} className="rounded-md p-2 text-slate-400 hover:text-indigo-600"><ExternalLink size={13}/></a></li>)}</ul>{filtered.length === 0 && <p className="rounded-xl bg-[#f8f9fd] p-6 text-center text-xs text-slate-500">No repositories match “{query}”. Try another name.</p>}</>}{repos.length > 0 && (projects.length ? <form onSubmit={link} className="mt-6 rounded-xl border border-[#e8e1f4] bg-[#faf8ff] p-4 sm:p-5"><h4 className="flex items-center gap-2 text-sm font-semibold"><Link2 size={16} className="text-[#8c70b6]"/>Link a repository</h4><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block min-w-0 text-xs font-medium text-slate-600">Repository<select required value={selectedRepo} onChange={event => { setSelectedRepo(event.target.value); setSuccess(""); }} aria-label="Choose repository" className="field"><option value="">Select a repository</option>{repos.map(repo => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}</select></label><label className="block min-w-0 text-xs font-medium text-slate-600">Project<select required value={selectedProject} onChange={event => { setSelectedProject(event.target.value); setSuccess(""); }} aria-label="Choose project" className="field"><option value="">Select a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><button type="submit" disabled={!selectedRepo || !selectedProject || linking} className="btn btn-primary mt-4">{linking ? <LoaderCircle size={15} className="animate-spin"/> : <Link2 size={15}/>} {linking ? "Linking…" : "Link repository"}</button></form> : <div className="notice mt-5"><FolderGit2 size={18} className="shrink-0"/><p>Create a project to give your repository a home.<Link href="/dashboard/projects#new-project" className="mt-2 flex items-center gap-2 font-semibold">Create a project<ArrowRight size={13}/></Link></p></div>)}{success && <p role="status" className="notice notice-success mt-4"><CheckCircle2 size={17} className="shrink-0"/>{success}</p>}{linkError && <p role="alert" className="notice notice-error mt-4"><AlertCircle size={17} className="shrink-0"/>{linkError}</p>}</>}</div>;
}
