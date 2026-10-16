-- CreateTable
CREATE TABLE "WantedSearch" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "mediaType" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "episodeId" INTEGER,
    "label" TEXT NOT NULL,
    "firstSearchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSearchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "gaveUpAt" DATETIME
);

-- CreateIndex
CREATE INDEX "WantedSearch_gaveUpAt_idx" ON "WantedSearch"("gaveUpAt");
