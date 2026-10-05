import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { Brand } from "@/components/ui";

export default function NotFound() {
  return <main className="hero-surface flex min-h-screen flex-col items-center justify-center px-6 py-12"><Brand/><div className="panel mt-10 w-full max-w-lg p-8 text-center sm:p-10"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#f0ecfc] text-[#9a7bcc]"><Compass size={27}/></span><p className="eyebrow mt-6">404 · A small detour</p><h1 className="mt-3 text-2xl font-semibold tracking-tight">This page is out of reach.</h1><p className="mt-3 text-sm leading-6 text-slate-500">The link may have changed, or this project may not be available to your account.</p><Link href="/" className="btn btn-primary mt-7"><ArrowLeft size={15}/>Back to home</Link></div></main>;
}
