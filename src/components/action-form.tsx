"use client";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { unstable_rethrow } from "next/navigation";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
export function SubmitButton({ children, pendingLabel = "Saving…", className = "btn btn-primary", disabled = false }: { children: ReactNode; pendingLabel?: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={disabled || pending} className={className}>{pending && <LoaderCircle size={16} className="animate-spin"/>}{pending ? pendingLabel : children}</button>;
}
export function ActionForm({ action, children, className, successMessage = "Changes saved." }: { action: (data: FormData) => Promise<void>; children: ReactNode; className?: string; successMessage?: string }) {
  const [state, formAction] = useActionState<{ error?: string; success?: string }, FormData>(async (_previous: { error?: string; success?: string }, data: FormData) => {
    try { await action(data); return { success: successMessage }; }
    catch (error) { unstable_rethrow(error); return { error: "We couldn’t save this change. Check your inputs and permissions, then try again." }; }
  }, {});
  return <form action={formAction} className={className}>{children}{state.error && <p role="alert" className="notice notice-error mt-4 w-full"><AlertCircle size={17} className="shrink-0"/>{state.error}</p>}{state.success && <p role="status" className="mt-3 flex w-full items-center gap-2 text-xs text-emerald-700"><CheckCircle2 size={15}/>{state.success}</p>}</form>;
}
