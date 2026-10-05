"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/action-form";

export function DeleteProjectForm({ projectName, action }: { projectName: string; action: (formData: FormData) => Promise<void> }) {
  const [confirmation, setConfirmation] = useState("");
  return <ActionForm action={action} className="mt-6 max-w-lg"><label className="block text-sm leading-6 text-slate-600">Type <strong>{projectName}</strong> to confirm permanent deletion.<input name="confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" required className="field border-red-200"/></label><SubmitButton disabled={confirmation !== projectName} className="btn btn-danger mt-4" pendingLabel="Deleting project…"><Trash2 size={15}/>Delete project permanently</SubmitButton></ActionForm>;
}
