"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Repo = { id: number; full_name: string; private: boolean };
export function RepositoryPicker({ projectId }: { projectId: string }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const router = useRouter();
  useEffect(() => { fetch("/api/github/repos").then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setRepos(data.repositories); }).catch(cause => setError(cause.message)); }, []);
  async function link() {
    const response = await fetch(`/api/projects/${projectId}/repository`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryId: Number(selected) }) });
    const data = await response.json();
    if (!response.ok) setError(data.error); else router.refresh();
  }
  return <div className="mt-4 flex flex-wrap items-center gap-3"><select value={selected} onChange={event => setSelected(event.target.value)} aria-label="Choose repository" className="max-w-full rounded-lg border border-white/10 bg-[#0a101a] px-4 py-3 text-sm"><option value="">Select a GitHub repository</option>{repos.map(repo => <option key={repo.id} value={repo.id}>{repo.full_name}{repo.private ? " (private)" : ""}</option>)}</select><button onClick={link} disabled={!selected} className="rounded-lg bg-orange-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">Link repository</button>{error && <p className="w-full text-sm text-red-400">{error}</p>}</div>;
}
