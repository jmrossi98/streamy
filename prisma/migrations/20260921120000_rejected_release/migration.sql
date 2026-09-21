-- CreateTable
CREATE TABLE "RejectedRelease" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaType" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "releaseTitle" TEXT NOT NULL,
    "downloadId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RejectedRelease_mediaType_externalId_idx" ON "RejectedRelease"("mediaType", "externalId");

-- CreateIndex
CREATE INDEX "RejectedRelease_downloadId_idx" ON "RejectedRelease"("downloadId");
