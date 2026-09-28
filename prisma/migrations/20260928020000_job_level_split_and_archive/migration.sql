-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobPosting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "metros" TEXT NOT NULL,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'swe',
    "level" TEXT NOT NULL DEFAULT 'mid',
    "openedAt" DATETIME,
    "postedAt" DATETIME,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" DATETIME,
    "archivedAt" DATETIME
);
INSERT INTO "new_JobPosting" ("category", "company", "firstSeen", "id", "lastSeen", "level", "location", "metros", "notifiedAt", "openedAt", "postedAt", "remote", "title", "url") SELECT "category", "company", "firstSeen", "id", "lastSeen", "level", "location", "metros", "notifiedAt", "openedAt", "postedAt", "remote", "title", "url" FROM "JobPosting";
DROP TABLE "JobPosting";
ALTER TABLE "new_JobPosting" RENAME TO "JobPosting";
CREATE INDEX "JobPosting_firstSeen_idx" ON "JobPosting"("firstSeen");
CREATE INDEX "JobPosting_lastSeen_idx" ON "JobPosting"("lastSeen");
CREATE INDEX "JobPosting_company_idx" ON "JobPosting"("company");
CREATE INDEX "JobPosting_category_idx" ON "JobPosting"("category");
CREATE INDEX "JobPosting_level_idx" ON "JobPosting"("level");
CREATE INDEX "JobPosting_openedAt_idx" ON "JobPosting"("openedAt");
CREATE INDEX "JobPosting_archivedAt_idx" ON "JobPosting"("archivedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Backfill the mid/senior split for existing rows. Approximate on purpose:
-- every poll rewrites level from classifyLevel for each posting still listed,
-- so this only has to be right until the next poll (30 minutes).
UPDATE "JobPosting" SET "level" = 'senior'
  WHERE "level" = 'midsenior'
    AND (lower("title") LIKE '%senior%' OR lower("title") LIKE '%sr.%'
         OR lower("title") LIKE '%sr %' OR lower("title") LIKE '% iii%');
UPDATE "JobPosting" SET "level" = 'mid' WHERE "level" = 'midsenior';
