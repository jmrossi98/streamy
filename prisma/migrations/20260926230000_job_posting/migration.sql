-- Open roles seen on company job boards.
--
-- Read from the applicant-tracking APIs companies already publish through
-- (Greenhouse, Ashby), not scraped: those endpoints are what the companies' own
-- careers pages call, so they are both the freshest source and the one that
-- needs no working around.
--
-- The primary key is the provider's own id, namespaced by provider and company
-- slug, so re-polling updates rather than duplicates and firstSeen keeps meaning
-- "when we first saw it" -- which is what notifications key off, since a
-- provider's own posted date is sometimes backdated and sometimes absent.
CREATE TABLE "JobPosting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    -- Comma-separated metro keys. A posting open in several cities belongs to
    -- all of them; filing it under one would hide it from the rest.
    "metros" TEXT NOT NULL,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" DATETIME,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Set once announced, so a re-poll or a restart cannot announce twice.
    "notifiedAt" DATETIME
);
CREATE INDEX "JobPosting_firstSeen_idx" ON "JobPosting"("firstSeen");
CREATE INDEX "JobPosting_lastSeen_idx" ON "JobPosting"("lastSeen");
CREATE INDEX "JobPosting_company_idx" ON "JobPosting"("company");
