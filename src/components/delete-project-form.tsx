"use client";

import { useState } from "react";

export function DeleteProjectForm({ projectName, action }: { projectName: string; action: (formData: FormData) => Promise<void> }) {
  const [confirmation, setConfirmation] = useState("");
  return <form action={action} className="mt-5 max-w-lg">
    <label className="block text-sm text-slate-300">Type <strong>{projectName}</strong> to confirm permanent deletion.
      <input name="confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" required className="mt-2 block w-full rounded-lg border border-red-400/30 bg-[#0a101a] px-4 py-3 text-sm outline-none focus:border-red-400" />
    </label>
    <button disabled={confirmation !== projectName} className="mt-4 rounded-lg border border-red-400/50 px-4 py-3 text-sm font-semibold text-red-300 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40">Delete project permanently</button>
  </form>;
}
