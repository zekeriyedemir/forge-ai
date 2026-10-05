import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { GitHubIcon } from "@/components/github-icon";
import { DemoWorkspace } from "./workspace";

export const metadata: Metadata = {
  title: "Explore the demo · Forge AI",
  description: "Explore a sample Forge AI project, workflow, tasks, and reports. No account or repository access needed.",
};

export default function DemoPage() {
  return <main id="main-content" className="min-h-screen bg-[#f7f9fe] px-5 py-6 sm:px-10 sm:py-8">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-indigo-600"><ArrowLeft size={16} /> Back to Forge AI</Link>
        <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"><GitHubIcon size={16} /> Sign in with GitHub</Link>
      </header>
      <div className="mb-8 mt-12 max-w-2xl">
        <p className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700"><Sparkles size={14} /> Take a look around</p>
        <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">Your next idea, organized.</h1>
        <p className="mt-4 text-lg leading-8 text-slate-600">From a repository and a clear goal to a plan you can act on. Explore the sample workspace below.</p>
      </div>
      <DemoWorkspace />
      <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-indigo-100 bg-white px-6 py-5">
        <div><p className="font-semibold text-slate-900">Make room for your own project.</p><p className="mt-1 text-sm text-slate-600">Connect GitHub, choose a repository, and define your goal.</p></div>
        <Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:text-indigo-900">Create your workspace <ArrowRight size={16} /></Link>
      </footer>
    </div>
  </main>;
}
