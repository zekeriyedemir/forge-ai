"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, RotateCcw } from "lucide-react";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="flex min-h-[75vh] items-center justify-center px-6 py-12"><div className="panel w-full max-w-lg p-8 text-center sm:p-10"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#f3edff] text-[#9273c8]"><AlertCircle size={27}/></span><h1 className="mt-6 text-2xl font-semibold tracking-tight">Let’s get you back on track.</h1><p className="mt-3 text-sm leading-6 text-slate-500">We couldn’t load this page. Your connection may have been interrupted. Try again in a moment.</p><div className="mt-7 flex flex-wrap justify-center gap-3"><button type="button" onClick={() => retry()} className="btn btn-primary"><RotateCcw size={15}/>Try again</button><Link href="/" className="btn btn-secondary"><ArrowLeft size={15}/>Back to home</Link></div></div></main>;
}
