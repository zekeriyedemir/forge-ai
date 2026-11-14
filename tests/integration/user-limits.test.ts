import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { assertUserLimit } from "@/lib/user-limits";

const integration = process.env.RUN_DB_INTEGRATION === "true" ? describe : describe.skip;
afterAll(async () => { await db.$disconnect(); });

integration("database-backed per-user limits", () => {
  it("counts projects, workflow starts, and Developer proposals in their protected windows", async () => {
    const savedLimits = {
      projects: process.env.MAX_PROJECTS_PER_USER,
      workflows: process.env.MAX_WORKFLOW_STARTS_PER_USER_PER_DAY,
      proposals: process.env.MAX_DEVELOPER_PROPOSALS_PER_USER_PER_DAY,
    };
    process.env.MAX_PROJECTS_PER_USER = "1";
    process.env.MAX_WORKFLOW_STARTS_PER_USER_PER_DAY = "2";
    process.env.MAX_DEVELOPER_PROPOSALS_PER_USER_PER_DAY = "2";

    const user = await db.user.create({ data: { email: `user-limit-${crypto.randomUUID()}@forge.test` } });
    const workspace = await db.workspace.create({ data: { name: "User limit integration fixture" } });
    try {
      await db.workspaceMember.create({ data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" } });
      const project = await db.project.create({ data: { workspaceId: workspace.id, name: "Limit fixture" } });
      const now = new Date();
      const old = new Date(now.getTime() - 25 * 60 * 60 * 1000);
      const agent = await db.agent.create({ data: { projectId: project.id, type: "FOUNDER" } });
      await db.agentRun.createMany({ data: [
        { projectId: project.id, agentId: agent.id, workflowId: crypto.randomUUID(), step: 0, type: "FOUNDER", input: {}, createdAt: now },
        { projectId: project.id, agentId: agent.id, workflowId: crypto.randomUUID(), step: 0, type: "FOUNDER", input: {}, createdAt: old },
      ] });

      const repository = await db.gitHubRepository.create({ data: { projectId: project.id, githubId: BigInt(Date.now()), fullName: "fixture/limits", url: "https://github.com/fixture/limits", defaultBranch: "main" } });
      const task = await db.task.create({ data: { projectId: project.id, title: "Limit fixture task" } });
      const fixtureId = crypto.randomUUID();
      const currentExecution = await db.developerExecution.create({ data: {
        projectId: project.id, taskId: task.id, repositoryId: repository.id, repositoryGithubId: repository.githubId,
        repositoryFullName: repository.fullName, branch: `forge/current-limit-${fixtureId}`, targetBranch: "main",
        baseSha: "a".repeat(40), proposal: {},
      } });
      const oldExecution = await db.developerExecution.create({ data: {
        projectId: project.id, repositoryId: repository.id, repositoryGithubId: repository.githubId,
        repositoryFullName: repository.fullName, branch: `forge/old-limit-${fixtureId}`, targetBranch: "main",
        baseSha: "b".repeat(40), proposal: {},
      } });
      await db.approvalRequest.createMany({ data: [
        { projectId: project.id, executionId: currentExecution.id, action: "IMPLEMENT", requestedById: user.id, description: "Current proposal", payload: {}, requestedAt: now },
        { projectId: project.id, executionId: oldExecution.id, action: "IMPLEMENT", requestedById: user.id, description: "Old proposal", payload: {}, requestedAt: old },
      ] });

      await expect(db.$transaction(tx => assertUserLimit(tx, user.id, "projects"))).rejects.toMatchObject({ kind: "projects", limit: 1 });
      await expect(db.$transaction(tx => assertUserLimit(tx, user.id, "workflows", now))).resolves.toBeUndefined();
      process.env.MAX_WORKFLOW_STARTS_PER_USER_PER_DAY = "1";
      await expect(db.$transaction(tx => assertUserLimit(tx, user.id, "workflows", now))).rejects.toMatchObject({ kind: "workflows", limit: 1 });
      await expect(db.$transaction(tx => assertUserLimit(tx, user.id, "developerProposals", now))).resolves.toBeUndefined();
      process.env.MAX_DEVELOPER_PROPOSALS_PER_USER_PER_DAY = "1";
      await expect(db.$transaction(tx => assertUserLimit(tx, user.id, "developerProposals", now))).rejects.toMatchObject({ kind: "developerProposals", limit: 1 });
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: user.id } });
      if (savedLimits.projects === undefined) delete process.env.MAX_PROJECTS_PER_USER;
      else process.env.MAX_PROJECTS_PER_USER = savedLimits.projects;
      if (savedLimits.workflows === undefined) delete process.env.MAX_WORKFLOW_STARTS_PER_USER_PER_DAY;
      else process.env.MAX_WORKFLOW_STARTS_PER_USER_PER_DAY = savedLimits.workflows;
      if (savedLimits.proposals === undefined) delete process.env.MAX_DEVELOPER_PROPOSALS_PER_USER_PER_DAY;
      else process.env.MAX_DEVELOPER_PROPOSALS_PER_USER_PER_DAY = savedLimits.proposals;
    }
  }, 30_000);
});
