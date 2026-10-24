-- CreateTable
CREATE TABLE "ResumeJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "step" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "note" TEXT,
    "versionId" TEXT,
    "requestedBy" TEXT NOT NULL DEFAULT '',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "heartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ResumeJob_postingId_startedAt_idx" ON "ResumeJob"("postingId", "startedAt");

-- CreateIndex
CREATE INDEX "ResumeJob_startedAt_idx" ON "ResumeJob"("startedAt");
