"use client";

import { useState } from "react";
import { ArrowRight, Check, CheckCircle2, Circle, FileText, FolderKanban, GitBranch, Layers3, ListChecks, LockKeyhole, Sparkles } from "lucide-react";
import { GitHubIcon } from "@/components/github-icon";

const tabs = ["Overview", "Tasks", "Reports"] as const;
const steps = ["Strategy", "Research", "Refine strategy", "Development plan", "Progress review"];
const tasks = [
  { title: "Map the core issue triage journey", detail: "Define the path from a new GitHub issue to an actionable task.", status: "Done" },
  { title: "Build the repository overview", detail: "Show open issues, labels, and recent changes in one place.", status: "In progress" },
  { title: "Add validation to the issue form", detail: "Handle missing titles, invalid input, and GitHub API failures.", status: "To do" },
  { title: "Test with a small development team", detail: "Observe the workflow and collect feedback before expanding scope.", status: "To do" },
];

export function DemoWorkspace() {
  const [tab, setTab] = useState<typeof tabs[number]>("Overview");
  return <section aria-label="Sample workspace" className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_20px_70px_-30px_rgba(67,56,202,0.25)]">
    <div className="flex items-start gap-3 border-b border-indigo-100 bg-indigo-50 px-5 py-4 text-sm leading-6 text-indigo-900 sm:px-7"><LockKeyhole size={17} className="mt-0.5 shrink-0" /><p><strong>Read-only sample.</strong> All content is illustrative. This demo makes no AI requests, reads no repositories, and saves no changes.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-5 px-6 py-7 sm:px-8">
      <div className="flex items-center gap-4"><span className="grid size-12 place-items-center rounded-2xl bg-indigo-100 text-indigo-600"><FolderKanban size={24} /></span><div><p className="text-xs font-medium text-slate-500">Sample workspace / Project</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Issue Compass</h2></div></div>
      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 size={14} /> Sample workflow complete</span>
    </div>
    <div role="tablist" aria-label="Sample project sections" className="flex gap-1 border-b border-slate-100 px-4 sm:px-7">{tabs.map((item, index) => <button type="button" key={item} id={`sample-tab-${item}`} role="tab" aria-selected={tab === item} aria-controls={`sample-panel-${item}`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      setTab(tabs[next]);
      document.getElementById(`sample-tab-${tabs[next]}`)?.focus();
    }} className={`border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${tab === item ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{item}</button>)}</div>
    <div role="tabpanel" tabIndex={0} id={`sample-panel-${tab}`} aria-labelledby={`sample-tab-${tab}`} className="min-h-[390px] bg-slate-50/60 p-5 sm:p-8">
      {tab === "Overview" && <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5"><section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-6"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-700"><Sparkles size={14} /> Project goal</p><h3 className="mt-4 text-xl font-semibold leading-8 text-slate-900">Help small teams turn GitHub issues into a focused development plan.</h3><p className="mt-3 text-sm leading-6 text-slate-600">Start with a narrow workflow: connect a repository, prioritize issues, and track the next useful change.</p></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-6"><h3 className="flex items-center gap-2 font-semibold text-slate-900"><Layers3 size={17} className="text-indigo-500" /> From goal to next steps</h3><ol className="mt-5 space-y-4">{steps.map((step, index) => <li key={step} className="flex items-center gap-3 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Check size={13} /></span><span className="text-slate-700">{step}</span><span className="ml-auto text-xs text-slate-400">0{index + 1}</span></li>)}</ol></section></div>
        <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-6"><h3 className="flex items-center gap-2 font-semibold text-slate-900"><GitHubIcon size={18} /> Repository</h3><p className="mt-5 break-all text-sm font-semibold text-indigo-700">sample / issue-compass</p><p className="mt-2 text-sm text-slate-500">Illustrative repository</p><div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><GitBranch size={14} /> main <span className="ml-3 size-2 rounded-full bg-blue-500" /> TypeScript</div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-6"><h3 className="flex items-center gap-2 font-semibold text-slate-900"><ListChecks size={18} className="text-indigo-500" /> A clear next step</h3><p className="mt-4 text-sm leading-6 text-slate-600">The sample plan contains four actionable tasks, each with a specific outcome.</p><button type="button" onClick={() => setTab("Tasks")} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700">Explore sample tasks <ArrowRight size={15} /></button></section></div>
      </div>}
      {tab === "Tasks" && <section><div className="mb-5"><h3 className="text-xl font-semibold text-slate-900">Small steps. Meaningful progress.</h3><p className="mt-2 text-sm text-slate-600">Illustrative tasks from a completed planning workflow.</p></div><div className="space-y-3">{tasks.map(task => <article key={task.title} className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5">{task.status === "Done" ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={20} className="mt-0.5 shrink-0 text-slate-300" />}<div className="min-w-0 flex-1"><h4 className="font-semibold text-slate-900">{task.title}</h4><p className="mt-1 text-sm leading-6 text-slate-600">{task.detail}</p><span className={`mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${task.status === "Done" ? "bg-emerald-50 text-emerald-700" : task.status === "In progress" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{task.status}</span></div></article>)}</div></section>}
      {tab === "Reports" && <article className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><span className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700"><FileText size={14} /> Sample development plan</span><h3 className="mt-5 text-2xl font-semibold text-slate-900">Build one useful workflow first.</h3><div className="mt-5 max-w-2xl space-y-5 text-sm leading-7 text-slate-600"><p>Issue Compass helps a small team answer one question: what should we work on next? The first version brings repository context and an actionable issue list into a single workspace.</p><div><h4 className="font-semibold text-slate-900">Implementation approach</h4><p>Use GitHub OAuth for authentication, fetch repositories on the server, and keep a project’s tasks in PostgreSQL. Validate inputs at the boundary and show a recoverable error if an integration is unavailable.</p></div><div><h4 className="font-semibold text-slate-900">Before shipping</h4><p>Test ownership checks, repository selection, and failure states. Review proposed code changes before opening a pull request, and require passing checks before approving a merge.</p></div><p className="border-t border-slate-100 pt-4 text-xs text-slate-500">This is curated example content, not a live AI result or verified market research.</p></div></article>}
    </div>
  </section>;
}
