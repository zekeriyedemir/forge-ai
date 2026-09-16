-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('IMPLEMENT', 'MERGE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'EXECUTING', 'REJECTED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeveloperStatus" AS ENUM ('PROPOSED', 'BRANCH_CREATED', 'COMMITTED', 'PR_OPEN', 'MERGED', 'FAILED');

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "executionId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "error" TEXT,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeveloperExecution" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "taskId" TEXT,
    "repositoryId" TEXT NOT NULL,
    "repositoryGithubId" BIGINT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "status" "DeveloperStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposal" JSONB NOT NULL,
    "branch" TEXT NOT NULL,
    "targetBranch" TEXT NOT NULL,
    "baseSha" TEXT NOT NULL,
    "commitSha" TEXT,
    "pullNumber" INTEGER,
    "pullUrl" TEXT,
    "pullState" TEXT,
    "validationSummary" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeveloperExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalRequest_projectId_status_requestedAt_idx" ON "ApprovalRequest"("projectId", "status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_executionId_action_key" ON "ApprovalRequest"("executionId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "DeveloperExecution_branch_key" ON "DeveloperExecution"("branch");

-- CreateIndex
CREATE INDEX "DeveloperExecution_projectId_createdAt_idx" ON "DeveloperExecution"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeveloperExecution_projectId_taskId_key" ON "DeveloperExecution"("projectId", "taskId");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "DeveloperExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeveloperExecution" ADD CONSTRAINT "DeveloperExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeveloperExecution" ADD CONSTRAINT "DeveloperExecution_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GitHubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeveloperExecution" ADD CONSTRAINT "DeveloperExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeveloperExecution" ADD CONSTRAINT "DeveloperExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
