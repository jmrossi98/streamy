-- CreateTable
CREATE TABLE "ResumeVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postingId" TEXT,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "markdown" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ResumeVersion_createdAt_idx" ON "ResumeVersion"("createdAt");

-- CreateIndex
CREATE INDEX "ResumeVersion_postingId_idx" ON "ResumeVersion"("postingId");

