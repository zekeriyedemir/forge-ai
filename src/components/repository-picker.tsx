"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Repo = { id: number; full_name: string; html_url: string; private: boolean };
type Project = { id: string; name: string };

export function RepositoryPicker({ projects }: { projects: Project[] }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linking, setLinking] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [requestKey, setRequestKey] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/github/repos", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load GitHub repositories.");
        if (!Array.isArray(data.repositories)) throw new Error("GitHub returned an unexpected response. Try again.");
        return data.repositories as Repo[];
      })
      .then(data => { setRepos(data); setError(""); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load GitHub repositories."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestKey]);

  function retry() {
    setError("");
    setLoading(true);
    setRequestKey(key => key + 1);
  }

  async function link() {
    if (!selectedProject || !selectedRepo) return;
    setLinkError("");
    setLinking(true);
    try {
      const response = await fetch(`/api/projects/${selectedProject}/repository`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryId: Number(selectedRepo) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not link the repository.");
      router.refresh();
    } catch (cause) { setLinkError(cause instanceof Error ? cause.message : "Could not link the repository."); }
    finally { setLinking(false); }
  }

  return <div className="mt-6 border-t border-white/10 pt-6">
    <h3 className="font-semibold">Your repositories</h3>
    {loading && <p role="status" className="mt-3 text-sm text-slate-400">Loading your GitHub repositories…</p>}
    {!loading && error && <div role="alert" className="mt-3 text-sm text-red-400"><p>{error}</p><button type="button" onClick={retry} className="mt-2 underline">Try again</button></div>}
    {!loading && !error && <>
      <p className="mt-2 text-sm text-slate-400">{repos.length ? `${repos.length} repositories available to your GitHub authorization.` : "No repositories are available to this GitHub authorization."}</p>
      {repos.length > 0 && <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto" aria-label="GitHub repositories">{repos.map(repo => <li key={repo.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[.035] px-3 py-2 text-sm"><a href={repo.html_url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-orange-400 hover:underline">{repo.full_name}</a><span className="shrink-0 text-xs text-slate-500">{repo.private ? "Private" : "Public"}</span></li>)}</ul>}
      {repos.length > 0 && (projects.length ? <div className="mt-5 flex flex-wrap gap-3">
        <select value={selectedRepo} onChange={event => setSelectedRepo(event.target.value)} aria-label="Choose repository" className="max-w-full rounded-lg border border-white/10 bg-[#0a101a] px-4 py-3 text-sm"><option value="">Select a repository</option>{repos.map(repo => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}</select>
        <select value={selectedProject} onChange={event => setSelectedProject(event.target.value)} aria-label="Choose project" className="max-w-full rounded-lg border border-white/10 bg-[#0a101a] px-4 py-3 text-sm"><option value="">Select a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <button type="button" onClick={link} disabled={!selectedRepo || !selectedProject || linking} className="rounded-lg bg-orange-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">{linking ? "Linking…" : "Link repository"}</button>
      </div> : <p className="mt-5 text-sm text-slate-400"><Link href="/dashboard/projects" className="text-orange-400 underline">Create a project</Link> to link a repository.</p>)}
      {linkError && <p role="alert" className="mt-3 text-sm text-red-400">{linkError}</p>}
    </>}
  </div>;
}
