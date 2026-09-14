import { auth, signOut } from "@/auth";

export default async function Settings() {
  const session = await auth();
  return <section className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[.25em] text-orange-400">Account</p><h1 className="mt-3 text-4xl font-bold">Settings</h1><div className="mt-9 rounded-2xl border border-white/10 bg-[#111824] p-7"><p className="text-sm text-slate-500">Signed in as</p><p className="mt-2 font-semibold">{session?.user?.email ?? "Demo Founder"}</p>{session && <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}><button className="mt-7 rounded-lg border border-white/20 px-4 py-2 text-sm hover:border-orange-400">Sign out</button></form>}</div></section>;
}
