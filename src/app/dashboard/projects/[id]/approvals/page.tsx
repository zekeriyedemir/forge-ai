import { notFound, redirect } from "next/navigation";
import { authenticatedUserId, projectForOwner } from "@/lib/access";
import { db } from "@/lib/db";
import { proposalSchema } from "@/lib/developer/contracts";
import { decideDevelopment, proposeDevelopment, retryDevelopment } from "@/app/developer-actions";

export default async function ApprovalCenter({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const userId = await authenticatedUserId();
  if (!userId) redirect("/login");
  if (!await projectForOwner(id, userId)) notFound();
  const [repository, tasks, approvals, executions, query] = await Promise.all([
    db.gitHubRepository.findUnique({ where: { projectId: id } }),
    db.task.findMany({ where: { projectId: id, status: { not: "DONE" } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.approvalRequest.findMany({ where: { projectId: id }, include: { execution: true }, orderBy: { requestedAt: "desc" }, take: 50 }),
    db.developerExecution.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    searchParams,
  ]);
  return <section className="space-y-8">
    <div><h2 className="text-2xl font-semibold">Approval Center</h2><p className="mt-2 text-sm text-slate-400">Review exact proposed files before repository writes. A separate approval is required to merge a pull request.</p></div>
    {query.error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{query.error}</p>}
    <div className="rounded-2xl border border-white/10 bg-[#111824] p-6"><h3 className="font-semibold">Create a Developer proposal</h3><p className="mt-2 text-sm text-slate-400">{repository ? `Linked repository: ${repository.fullName}. Proposal generation uses your configured live AI provider.` : "Link a GitHub repository from the project overview first."}</p>
      {repository && <form action={proposeDevelopment.bind(null, id)} className="mt-4 flex flex-wrap gap-3"><select name="taskId" required aria-label="Development task" className="min-w-64 rounded-lg border border-white/10 bg-[#0a101a] px-3 py-2 text-sm">{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select><button disabled={tasks.length === 0} className="rounded-lg bg-orange-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Inspect repository and propose</button></form>}
      {tasks.length === 0 && <p className="mt-3 text-sm text-slate-500">Add or generate a task first.</p>}
    </div>
    <div className="space-y-4"><h3 className="text-lg font-semibold">Requests and decisions</h3>{approvals.map(approval => {
      const proposal = proposalSchema.safeParse(approval.execution.proposal);
      return <article key={approval.id} className="rounded-2xl border border-white/10 bg-[#111824] p-6">
        <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">{approval.action === "IMPLEMENT" ? "Repository implementation" : "Pull request merge"}</h4><span className="text-xs font-bold text-orange-400">{approval.status}</span></div>
        <p className="mt-2 text-sm text-slate-300">{approval.description}</p><p className="mt-2 text-xs text-slate-500">Requested {approval.requestedAt.toLocaleString()} · Branch {approval.execution.branch} → {approval.execution.targetBranch}</p>
        {approval.action === "IMPLEMENT" && proposal.success && <div className="mt-4 space-y-3 text-sm"><p>{proposal.data.summary}</p><p className="text-slate-400">Validation plan: {proposal.data.validationPlan}</p><p className="text-amber-300">Risks: {proposal.data.risks}</p><p className="text-slate-400">Commit: {proposal.data.commitMessage}</p><details className="rounded-lg border border-white/10 p-3"><summary className="cursor-pointer">Review {proposal.data.files.length} proposed file(s)</summary>{proposal.data.files.map(file => <div key={file.path} className="mt-4"><p className="font-mono text-orange-300">{file.path}</p><p className="mt-1 text-slate-400">{file.reason}</p><pre className="mt-2 max-h-96 overflow-auto rounded bg-black/30 p-3 text-xs">{file.content}</pre></div>)}</details></div>}
        {approval.action === "MERGE" && <p className="mt-3 text-sm text-slate-400">Approved head: {approval.execution.commitSha ?? "—"}. Forge rechecks this SHA, PR state, mergeability, and GitHub checks before merging.</p>}
        {approval.error && <p className="mt-3 text-sm text-red-300">{approval.error}</p>}
        {approval.status === "PENDING" && <div className="mt-5 flex gap-3"><form action={decideDevelopment.bind(null, id, approval.id)}><input type="hidden" name="decision" value="approve" /><button className="rounded-lg bg-orange-400 px-4 py-2 text-sm font-semibold text-slate-950">{approval.action === "MERGE" ? "Approve & merge" : "Approve & execute"}</button></form><form action={decideDevelopment.bind(null, id, approval.id)}><input type="hidden" name="decision" value="reject" /><button className="rounded-lg border border-white/15 px-4 py-2 text-sm">Reject</button></form></div>}
        {(approval.status === "FAILED" || approval.status === "EXECUTING") && approval.decidedById === userId && <form action={retryDevelopment.bind(null, id, approval.id)} className="mt-4"><button className="rounded-lg border border-orange-400/50 px-4 py-2 text-sm text-orange-300">{approval.status === "EXECUTING" ? "Retry if running for over 15 minutes" : "Retry approved operation"}</button></form>}
      </article>;
    })}{approvals.length === 0 && <p className="text-sm text-slate-500">No approval requests yet.</p>}</div>
    <div className="space-y-4"><h3 className="text-lg font-semibold">Developer executions</h3>{executions.map(execution => <article key={execution.id} className="rounded-2xl border border-white/10 bg-[#111824] p-5 text-sm"><div className="flex justify-between"><strong>{execution.branch}</strong><span className="text-orange-400">{execution.status}</span></div><p className="mt-2 text-slate-400">Target: {execution.targetBranch} · Commit: {execution.commitSha ?? "pending"}</p><p className="mt-2 text-slate-400">Validation: {execution.validationSummary ?? "pending"}</p>{execution.pullUrl && <a href={execution.pullUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-orange-300 underline">Review PR #{execution.pullNumber} on GitHub</a>}{execution.error && <p className="mt-2 text-red-300">{execution.error}</p>}</article>)}</div>
  </section>;
}
