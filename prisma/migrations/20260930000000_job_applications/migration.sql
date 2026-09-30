-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postingId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "boardSlug" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "applyUrl" TEXT NOT NULL,
    "resumeVersionId" TEXT,
    "answers" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "JobApplication_provider_boardSlug_jobId_idx" ON "JobApplication"("provider", "boardSlug", "jobId");

-- CreateIndex
CREATE INDEX "JobApplication_postingId_idx" ON "JobApplication"("postingId");
