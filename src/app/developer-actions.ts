"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authenticatedUserId, projectForOwner } from "@/lib/access";
import { db } from "@/lib/db";
import { DeveloperFlowError, createCiCorrection, createDeveloperProposal, decideApproval, executeCiCorrection, executeExternalHeadAdoption, executeImplementation, executeMerge, observeDeveloperCi, reviewExternalHead, retryApproval } from "@/lib/developer/runtime";
import { DeveloperProposalError, RepositoryValidationError } from "@/lib/developer/diagnostics";
import { DeveloperGitHubError } from "@/lib/developer/github";
import { AiProviderError } from "@/lib/agents/provider";

async function identity(projectId: string) {
  z.uuid().parse(projectId);
  const userId = await authenticatedUserId();
  if (!userId) redirect("/login");
  if (!await projectForOwner(projectId, userId)) throw new Error("Project not found or access denied.");
  return userId;
}

function destination(projectId: string, error?: string) {
  const path = `/dashboard/projects/${projectId}/approvals`;
  revalidatePath(path);
  redirect(error ? `${path}?error=${encodeURIComponent(error.slice(0, 240))}` : path);
}

function message(error: unknown) {
  if (error instanceof DeveloperProposalError) return error.publicMessage;
  if (error instanceof DeveloperFlowError || error instanceof AiProviderError || error instanceof DeveloperGitHubError || error instanceof RepositoryValidationError) return error.message;
  return "Operation failed. Review the project activity and retry.";
}

export async function proposeDevelopment(projectId: string, formData: FormData) {
  const userId = await identity(projectId);
  const taskId = z.uuid().parse(formData.get("taskId"));
  let error: string | undefined;
  try { await createDeveloperProposal(projectId, taskId, userId); }
  catch (cause) { error = message(cause); }
  destination(projectId, error);
}

export async function decideDevelopment(projectId: string, approvalId: string, formData: FormData) {
  const userId = await identity(projectId);
  z.uuid().parse(approvalId);
  const decision = z.enum(["approve", "reject"]).parse(formData.get("decision"));
  let error: string | undefined;
  try {
    const action = await decideApproval(projectId, approvalId, userId, decision);
    if (decision === "approve") {
      if (action === "IMPLEMENT") await executeImplementation(projectId, approvalId, userId);
      else if (action === "FIX") await executeCiCorrection(projectId, approvalId, userId);
      else if (action === "ADOPT") await executeExternalHeadAdoption(projectId, approvalId, userId);
      else await executeMerge(projectId, approvalId, userId);
    }
  } catch (cause) { error = message(cause); }
  destination(projectId, error);
}

export async function retryDevelopment(projectId: string, approvalId: string) {
  const userId = await identity(projectId);
  z.uuid().parse(approvalId);
  let error: string | undefined;
  try {
    const approval = await db.approvalRequest.findFirst({ where: { id: approvalId, projectId }, select: { action: true } });
    if (!approval) throw new Error("Approval not found.");
    await retryApproval(projectId, approvalId, userId);
    if (approval.action === "IMPLEMENT") await executeImplementation(projectId, approvalId, userId);
    else if (approval.action === "FIX") await executeCiCorrection(projectId, approvalId, userId);
    else if (approval.action === "ADOPT") await executeExternalHeadAdoption(projectId, approvalId, userId);
    else await executeMerge(projectId, approvalId, userId);
  } catch (cause) { error = message(cause); }
  destination(projectId, error);
}

export async function observeDevelopmentCi(projectId: string, executionId: string) {
  const userId = await identity(projectId);
  z.uuid().parse(executionId);
  let error: string | undefined;
  try { await observeDeveloperCi(projectId, executionId, userId); }
  catch (cause) { error = message(cause); }
  destination(projectId, error);
}

export async function proposeDevelopmentCorrection(projectId: string, executionId: string) {
  const userId = await identity(projectId);
  z.uuid().parse(executionId);
  let error: string | undefined;
  try { await createCiCorrection(projectId, executionId, userId); }
  catch (cause) { error = message(cause); }
  destination(projectId, error);
}

export async function reviewDevelopmentExternalHead(projectId: string, executionId: string) {
  const userId = await identity(projectId);
  z.uuid().parse(executionId);
  let error: string | undefined;
  try { await reviewExternalHead(projectId, executionId, userId); }
  catch (cause) { error = message(cause); }
  destination(projectId, error);
}
