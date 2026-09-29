-- AlterTable
ALTER TABLE "JobBoardSource" ADD COLUMN "lastCheckedAt" DATETIME;
ALTER TABLE "JobBoardSource" ADD COLUMN "lastSuccessAt" DATETIME;
ALTER TABLE "JobBoardSource" ADD COLUMN "lastError" TEXT;
ALTER TABLE "JobBoardSource" ADD COLUMN "lastCount" INTEGER;
