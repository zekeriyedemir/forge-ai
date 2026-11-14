import { Prisma } from "@prisma/client";
import { userLimits } from "@/lib/env";

export type UserLimitKind = "projects" | "workflows" | "developerProposals";

export class UserLimitError extends Error {
  constructor(readonly kind: UserLimitKind, readonly limit: number) {
    const message = {
      projects: `Project limit reached. Your account can have up to ${limit} projects.`,
      workflows: `Workflow limit reached. Your account can start up to ${limit} workflows in 24 hours.`,
      developerProposals: `Developer proposal limit reached. Your account can create up to ${limit} proposals in 24 hours.`,
    }[kind];
    super(message);
    this.name = "UserLimitError";
  }
}

const windowStart = (now: Date) => new Date(now.getTime() - 24 * 60 * 60 * 1000);

export async function assertUserLimit(tx: Prisma.TransactionClient, userId: string, kind: UserLimitKind, now = new Date()) {
  const limits = userLimits();
  const limit = kind === "projects"
    ? limits.MAX_PROJECTS_PER_USER
    : kind === "workflows"
      ? limits.MAX_WORKFLOW_STARTS_PER_USER_PER_DAY
      : limits.MAX_DEVELOPER_PROPOSALS_PER_USER_PER_DAY;

  const count = kind === "projects"
    ? await tx.project.count({ where: { workspace: { members: { some: { userId } } } } })
    : kind === "workflows"
      ? await tx.agentRun.count({ where: { type: "FOUNDER", step: 0, createdAt: { gte: windowStart(now) }, project: { workspace: { members: { some: { userId } } } } } })
      : await tx.approvalRequest.count({ where: { action: "IMPLEMENT", requestedById: userId, requestedAt: { gte: windowStart(now) } } });

  if (count >= limit) throw new UserLimitError(kind, limit);
}
