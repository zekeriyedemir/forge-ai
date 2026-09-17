-- CreateEnum
CREATE TYPE "DeveloperHeadSource" AS ENUM ('FORGE', 'EXTERNAL');

-- AlterEnum
ALTER TYPE "ApprovalAction" ADD VALUE 'ADOPT';

-- AlterEnum
ALTER TYPE "DeveloperStatus" ADD VALUE 'EXTERNAL_CHANGE';

-- AlterTable
ALTER TABLE "DeveloperExecution" ADD COLUMN "externalHeadSha" TEXT,
ADD COLUMN "headSource" "DeveloperHeadSource" NOT NULL DEFAULT 'FORGE';
