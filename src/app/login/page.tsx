import { signIn } from "@/auth";
import Link from "next/link";

export default function Login() {
  return <main className="flex min-h-screen items-center justify-center px-6"><div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111824] p-10 text-center"><Link href="/" className="text-2xl font-black tracking-[.25em] text-orange-400">FORGE AI</Link><h1 className="mt-10 text-3xl font-semibold">Welcome to the forge</h1><p className="mt-3 text-slate-400">Connect your GitHub account to start building.</p><form action={async () => { "use server"; await signIn("github", { redirectTo: "/dashboard" }); }}><button className="mt-8 w-full rounded-xl bg-orange-400 px-5 py-3 font-semibold text-slate-950 hover:bg-orange-300">Continue with GitHub</button></form>{process.env.DEMO_MODE === "true" && <Link href="/dashboard" className="mt-5 block text-sm text-slate-400 underline">Explore demo mode</Link>}</div></main>;
}
