-- AlterTable: MediaRequest becomes shared/global per (tmdbId, mediaType) instead of
-- one row per requesting user, so every user sees the same download status.
CREATE TABLE "new_MediaRequest" (
    "tmdbId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "tvdbId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "externalId" INTEGER,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("tmdbId", "mediaType")
);
INSERT INTO "new_MediaRequest" ("tmdbId", "mediaType", "tvdbId", "status", "externalId", "requestedAt", "updatedAt")
SELECT "tmdbId", "mediaType", "tvdbId", "status", "externalId", MIN("requestedAt"), MAX("updatedAt")
FROM "MediaRequest"
GROUP BY "tmdbId", "mediaType";
DROP TABLE "MediaRequest";
ALTER TABLE "new_MediaRequest" RENAME TO "MediaRequest";
CREATE INDEX "MediaRequest_tvdbId_idx" ON "MediaRequest"("tvdbId");
