import { auth, signOut } from "@/auth";
import { LogOut, UserRound } from "lucide-react";
import { PageHeader, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/action-form";

export default async function Settings() {
  const session = await auth();
  return <section className="mx-auto max-w-5xl"><PageHeader eyebrow="Your account" title="Settings" description="A home for your account and workspace preferences."/><div className="panel mt-8 max-w-2xl p-7"><div className="flex items-center gap-4"><span className="grid size-12 place-items-center rounded-2xl bg-[#efeafb] text-[#8b72c7]"><UserRound size={24}/></span><div><h2 className="font-semibold">{session?.user?.name ?? "Demo Founder"}</h2><p className="mt-1 text-xs text-slate-500">{session?.user?.email ?? "Local demonstration workspace"}</p></div></div><div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f7] pt-5"><p className="text-xs text-slate-500">Account access</p><StatusBadge tone={session ? "success" : "warning"}>{session ? "Signed in with GitHub" : "Local demo session"}</StatusBadge></div>{session && <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }} className="mt-7"><SubmitButton className="btn btn-secondary" pendingLabel="Signing out…"><LogOut size={15}/>Sign out</SubmitButton></form>}</div></section>;
}
