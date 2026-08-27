-- CreateTable
CREATE TABLE "WatchedPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "artist" TEXT,
    "selector" TEXT,
    "ignorePattern" TEXT,
    "keywords" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "contentHash" TEXT,
    "content" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "PageChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "diff" TEXT NOT NULL,
    "keywordHits" TEXT,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PageChange_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "WatchedPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TourDate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "date" TEXT,
    "detail" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "seenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TourDate_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "WatchedPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "avatarColor" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passwordChangedAt" DATETIME
);
INSERT INTO "new_User" ("approved", "avatarColor", "createdAt", "id", "isAdmin", "name", "password", "passwordChangedAt") SELECT "approved", "avatarColor", "createdAt", "id", "isAdmin", "name", "password", "passwordChangedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WatchedPage_url_key" ON "WatchedPage"("url");

-- CreateIndex
CREATE INDEX "WatchedPage_enabled_idx" ON "WatchedPage"("enabled");

-- CreateIndex
CREATE INDEX "PageChange_pageId_detectedAt_idx" ON "PageChange"("pageId", "detectedAt");

-- CreateIndex
CREATE INDEX "PageChange_detectedAt_idx" ON "PageChange"("detectedAt");

-- CreateIndex
CREATE INDEX "TourDate_pageId_idx" ON "TourDate"("pageId");

-- CreateIndex
CREATE INDEX "TourDate_artist_date_idx" ON "TourDate"("artist", "date");

-- CreateIndex
CREATE INDEX "TourDate_date_idx" ON "TourDate"("date");

-- CreateIndex
CREATE INDEX "EpisodeProgress_userId_updatedAt_idx" ON "EpisodeProgress"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "WatchProgress_userId_updatedAt_idx" ON "WatchProgress"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "WatchlistItem_userId_idx" ON "WatchlistItem"("userId");

-- CreateIndex
CREATE INDEX "WatchlistShowItem_userId_idx" ON "WatchlistShowItem"("userId");
