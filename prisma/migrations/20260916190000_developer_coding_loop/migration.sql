-- AlterEnum
ALTER TYPE "ApprovalAction" ADD VALUE 'FIX';

-- DropIndex
DROP INDEX "ApprovalRequest_executionId_action_key";

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN "baseSha" TEXT,
ADD COLUMN "failureSummary" TEXT,
ADD COLUMN "resultSha" TEXT,
ADD COLUMN "round" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DeveloperExecution" ADD COLUMN "ciChecks" JSONB,
ADD COLUMN "ciStatus" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
ADD COLUMN "ciSummary" TEXT,
ADD COLUMN "correctionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "inspectedPaths" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_executionId_action_round_key" ON "ApprovalRequest"("executionId", "action", "round");
