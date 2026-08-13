-- CreateTable
CREATE TABLE "MediaRequest" (
    "userId" TEXT NOT NULL,
    "tmdbId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "tvdbId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "externalId" INTEGER,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "tmdbId", "mediaType"),
    CONSTRAINT "MediaRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MediaRequest_userId_idx" ON "MediaRequest"("userId");

-- CreateIndex
CREATE INDEX "MediaRequest_tmdbId_mediaType_idx" ON "MediaRequest"("tmdbId", "mediaType");

-- CreateIndex
CREATE INDEX "MediaRequest_tvdbId_idx" ON "MediaRequest"("tvdbId");
