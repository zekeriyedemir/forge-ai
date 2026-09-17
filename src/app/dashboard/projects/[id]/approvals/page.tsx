import { notFound, redirect } from "next/navigation";
import { authenticatedUserId, projectForOwner } from "@/lib/access";
import { db } from "@/lib/db";
import { ciFixSchema, proposalSchema } from "@/lib/developer/contracts";
import { decideDevelopment, observeDevelopmentCi, proposeDevelopment, proposeDevelopmentCorrection, reviewDevelopmentExternalHead, retryDevelopment } from "@/app/developer-actions";

export const maxDuration = 120;

export default async function ApprovalCenter({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const userId = await authenticatedUserId();
  if (!userId) redirect("/login");
  if (!await projectForOwner(id, userId)) notFound();
  const [repository, tasks, approvals, executions, failures, query] = await Promise.all([
    db.gitHubRepository.findUnique({ where: { projectId: id } }),
    db.task.findMany({ where: { projectId: id, status: { not: "DONE" } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.approvalRequest.findMany({ where: { projectId: id }, include: { execution: true }, orderBy: { requestedAt: "desc" }, take: 50 }),
    db.developerExecution.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.activityEvent.findMany({ where: { projectId: id, kind: "developer-proposal-failed" }, orderBy: { createdAt: "desc" }, take: 5 }),
    searchParams,
  ]);
  return <section className="space-y-8">
    <div><h2 className="text-2xl font-semibold">Approval Center</h2><p className="mt-2 text-sm text-slate-400">Review exact proposed files before repository writes. A separate approval is required to merge a pull request.</p></div>
    {query.error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{query.error}</p>}
    {failures.length > 0 && <div className="rounded-2xl border border-red-400/20 bg-[#111824] p-5"><h3 className="font-semibold text-red-200">Recent proposal failures</h3><div className="mt-3 space-y-2">{failures.map(failure => <p key={failure.id} className="text-sm text-slate-300"><span className="text-slate-500">{failure.createdAt.toLocaleString()} · </span>{failure.message}</p>)}</div></div>}
    <div className="rounded-2xl border border-white/10 bg-[#111824] p-6"><h3 className="font-semibold">Create a Developer proposal</h3><p className="mt-2 text-sm text-slate-400">{repository ? `Linked repository: ${repository.fullName}. Proposal generation uses your configured live AI provider.` : "Link a GitHub repository from the project overview first."}</p>
      {repository && <form action={proposeDevelopment.bind(null, id)} className="mt-4 flex flex-wrap gap-3"><select name="taskId" required aria-label="Development task" className="min-w-64 rounded-lg border border-white/10 bg-[#0a101a] px-3 py-2 text-sm">{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select><button disabled={tasks.length === 0} className="rounded-lg bg-orange-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Inspect repository and propose</button></form>}
      {tasks.length === 0 && <p className="mt-3 text-sm text-slate-500">Add or generate a task first.</p>}
    </div>
    <div className="space-y-4"><h3 className="text-lg font-semibold">Requests and decisions</h3>{approvals.map(approval => {
      const proposal = proposalSchema.safeParse(approval.execution.proposal);
      const correction = approval.action === "FIX" && approval.payload && typeof approval.payload === "object" && !Array.isArray(approval.payload) ? ciFixSchema.safeParse(approval.payload.proposal) : null;
      const correctionPaths = approval.action === "FIX" && approval.payload && typeof approval.payload === "object" && !Array.isArray(approval.payload) && Array.isArray(approval.payload.inspectedPaths) ? approval.payload.inspectedPaths.filter((path): path is string => typeof path === "string") : [];
      const displayProposal = approval.action === "FIX" ? correction?.success ? correction.data : null : approval.action === "IMPLEMENT" && proposal.success ? proposal.data : null;
      return <article key={approval.id} className="rounded-2xl border border-white/10 bg-[#111824] p-6">
        <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">{approval.action === "IMPLEMENT" ? "Repository implementation" : approval.action === "FIX" ? `CI correction · round ${approval.round}/3` : approval.action === "ADOPT" ? "External head review" : "Pull request merge"}</h4><span className="text-xs font-bold text-orange-400">{approval.status}</span></div>
        <p className="mt-2 text-sm text-slate-300">{approval.description}</p><p className="mt-2 text-xs text-slate-500">Requested {approval.requestedAt.toLocaleString()} · Branch {approval.execution.branch} → {approval.execution.targetBranch}</p>
        {approval.action === "FIX" && correction?.success && <div className="mt-3 space-y-1 text-sm text-amber-200"><p>Observed failure: {approval.failureSummary ?? "GitHub CI failed."}</p><p>Failed job: {typeof approval.payload === "object" && approval.payload && !Array.isArray(approval.payload) && typeof approval.payload.job === "string" ? approval.payload.job : "unavailable"} · Step: {typeof approval.payload === "object" && approval.payload && !Array.isArray(approval.payload) && typeof approval.payload.step === "string" ? approval.payload.step : "unavailable"}</p><p>Proposed cause: {correction.data.likelyCause}</p><p>Approved base: {approval.baseSha}. New head: {approval.resultSha ?? "pending"}.</p></div>}
        {approval.action === "FIX" && correctionPaths.length > 0 && <details className="mt-3 text-xs text-slate-400"><summary className="cursor-pointer">Files inspected for this correction ({correctionPaths.length})</summary><ul className="mt-2 font-mono">{correctionPaths.map(path => <li key={path}>{path}</li>)}</ul></details>}
        {displayProposal && <div className="mt-4 space-y-3 text-sm"><p>{displayProposal.summary}</p><p className="text-slate-400">Validation plan: {displayProposal.validationPlan}</p><p className="text-slate-400">Expected success: {displayProposal.validationExpectation ?? "Review GitHub CI."}</p><p className="text-amber-300">Risks: {displayProposal.risks}</p><p className="text-slate-400">Commit: {displayProposal.commitMessage}</p><details className="rounded-lg border border-white/10 p-3"><summary className="cursor-pointer">Review {displayProposal.files.length} proposed file(s)</summary>{displayProposal.files.map(file => <div key={file.path} className="mt-4"><p className="font-mono text-orange-300">{file.operation ?? "CHANGE"} {file.path}</p><p className="mt-1 text-slate-400">{file.reason}</p><pre className="mt-2 max-h-96 overflow-auto rounded bg-black/30 p-3 text-xs">{file.content}</pre></div>)}</details></div>}
        {approval.action === "MERGE" && <p className="mt-3 text-sm text-slate-400">Approved head: {typeof approval.payload === "object" && approval.payload && !Array.isArray(approval.payload) && typeof approval.payload.headSha === "string" ? approval.payload.headSha : "—"}. Forge rechecks this SHA, PR state, mergeability, and GitHub checks before merging.</p>}
        {approval.action === "ADOPT" && <div className="mt-3 space-y-1 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100"><p>This branch changed outside Forge. Review the commit and PR diff on GitHub before accepting this exact head.</p><p>Forge-known SHA: <code>{approval.baseSha}</code></p><p>GitHub head to adopt: <code>{approval.resultSha}</code></p><p>PR #{approval.execution.pullNumber} · {approval.execution.branch} → {approval.execution.targetBranch}. Adoption makes no GitHub write or merge.</p></div>}
        {(approval.action === "MERGE" || approval.action === "FIX") && approval.execution.status === "EXTERNAL_CHANGE" && <p className="mt-2 text-sm text-amber-200">Blocked: review the external head before requesting a fresh approval.</p>}
        {approval.error && <p className="mt-3 text-sm text-red-300">{approval.error}</p>}
        {approval.status === "PENDING" && !((approval.action === "MERGE" || approval.action === "FIX") && approval.execution.status === "EXTERNAL_CHANGE") && <div className="mt-5 flex gap-3"><form action={decideDevelopment.bind(null, id, approval.id)}><input type="hidden" name="decision" value="approve" /><button className="rounded-lg bg-orange-400 px-4 py-2 text-sm font-semibold text-slate-950">{approval.action === "MERGE" ? "Approve & merge" : approval.action === "FIX" ? "Approve & push correction" : approval.action === "ADOPT" ? "Approve adoption & refresh CI" : "Approve & execute"}</button></form><form action={decideDevelopment.bind(null, id, approval.id)}><input type="hidden" name="decision" value="reject" /><button className="rounded-lg border border-white/15 px-4 py-2 text-sm">Reject</button></form></div>}
        {(approval.status === "FAILED" || approval.status === "EXECUTING") && approval.decidedById === userId && <form action={retryDevelopment.bind(null, id, approval.id)} className="mt-4"><button className="rounded-lg border border-orange-400/50 px-4 py-2 text-sm text-orange-300">{approval.status === "EXECUTING" ? "Retry if running for over 15 minutes" : "Retry approved operation"}</button></form>}
      </article>;
    })}{approvals.length === 0 && <p className="text-sm text-slate-500">No approval requests yet.</p>}</div>
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Developer executions</h3>
      {executions.map(execution => {
        const attempts = approvals.filter(approval => approval.executionId === execution.id && approval.action === "FIX").length;
        const mergeReady = execution.status === "PR_OPEN" && execution.ciStatus === "SUCCESS";
        return <article key={execution.id} className="rounded-2xl border border-white/10 bg-[#111824] p-5 text-sm">
          <div className="flex justify-between"><strong>{execution.branch}</strong><span className="text-orange-400">{execution.status}</span></div>
          <p className="mt-2 text-slate-400">Target: {execution.targetBranch} · Latest adopted head: {execution.commitSha ?? "pending"} · Source: {execution.headSource === "EXTERNAL" ? "external commit explicitly adopted" : "Forge"}</p>
          {execution.status === "EXTERNAL_CHANGE" && <div className="mt-3 space-y-1 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-amber-100"><p className="font-semibold">External change detected. CI corrections and merge are blocked until you review this head.</p><p>Forge-known previous SHA: <code>{execution.commitSha}</code></p><p>Current GitHub head SHA: <code>{execution.externalHeadSha ?? "unavailable"}</code></p><p>PR #{execution.pullNumber} · {execution.branch} → {execution.targetBranch}</p></div>}
          <p className="mt-2 text-slate-400">Validation: {execution.validationSummary ?? "pending"}</p>
          <p className="mt-2 text-slate-400">CI: <strong>{execution.ciStatus.toLowerCase()}</strong> · {execution.ciSummary ?? "Refresh after PR creation."}</p>
          <p className="mt-2 text-slate-400">Corrections: {execution.correctionCount} applied, {attempts}/3 proposed. {mergeReady ? "CI passed; review the separate merge approval. Forge will recheck GitHub before merging." : "Merge is not ready until current-head checks pass and a separate approval is given."}</p>
          {Array.isArray(execution.inspectedPaths) && <details className="mt-3"><summary className="cursor-pointer text-slate-300">Inspected source files ({execution.inspectedPaths.length})</summary><ul className="mt-2 font-mono text-xs text-slate-400">{execution.inspectedPaths.filter((path): path is string => typeof path === "string").map(path => <li key={path}>{path}</li>)}</ul></details>}
          {Array.isArray(execution.ciChecks) && <ul className="mt-2 text-xs text-slate-400">{execution.ciChecks.filter((check): check is { name: string; conclusion: string | null } => Boolean(check && typeof check === "object" && !Array.isArray(check) && typeof check.name === "string")).map((check, index) => <li key={`${check.name}-${index}`}>{check.name}: {check.conclusion ?? "pending"}</li>)}</ul>}
          {execution.pullUrl && <a href={execution.pullUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-orange-300 underline">Review PR #{execution.pullNumber} on GitHub</a>}
          {(execution.status === "PR_OPEN" || execution.status === "EXTERNAL_CHANGE") && <div className="mt-4 flex gap-3"><form action={observeDevelopmentCi.bind(null, id, execution.id)}><button className="rounded-lg border border-white/15 px-4 py-2 text-xs">Refresh CI</button></form>{execution.status === "EXTERNAL_CHANGE" && execution.externalHeadSha && <form action={reviewDevelopmentExternalHead.bind(null, id, execution.id)}><button className="rounded-lg border border-amber-400/50 px-4 py-2 text-xs text-amber-200">Review & adopt external head</button></form>}{execution.status === "PR_OPEN" && execution.ciStatus === "FAILURE" && attempts < 3 && <form action={proposeDevelopmentCorrection.bind(null, id, execution.id)}><button className="rounded-lg border border-orange-400/50 px-4 py-2 text-xs text-orange-300">Analyze failure & propose correction</button></form>}</div>}
          {execution.error && <p className="mt-2 text-red-300">{execution.error}</p>}
        </article>;
      })}
    </div>
  </section>;
}
