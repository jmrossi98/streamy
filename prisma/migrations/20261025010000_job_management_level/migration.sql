-- 2026-10-24: engineering-manager postings are kept under a "management"
-- level, and director/VP ones only when Jake could qualify. The requirement
-- is read from the listing once and stored; hiddenReason keeps a posting out
-- of the panel and the emails without deleting it (a deleted posting would
-- come back as new on the next poll).

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN "reqYears" INTEGER;
ALTER TABLE "JobPosting" ADD COLUMN "reqManagerYears" INTEGER;
ALTER TABLE "JobPosting" ADD COLUMN "reqStatus" TEXT;
ALTER TABLE "JobPosting" ADD COLUMN "reqCheckedAt" DATETIME;
ALTER TABLE "JobPosting" ADD COLUMN "hiddenReason" TEXT;

-- CreateIndex
CREATE INDEX "JobPosting_hiddenReason_idx" ON "JobPosting"("hiddenReason");
