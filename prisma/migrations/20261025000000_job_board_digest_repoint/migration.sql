-- 2026-10-24: email cadence, per-board "email immediately", rate-limit
-- back-off, silent seeding, and the board fixes Jake verified against the
-- public APIs that day.

-- AlterTable
ALTER TABLE "JobBoardSource" ADD COLUMN "notifyImmediately" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JobBoardSource" ADD COLUMN "seededAt" DATETIME;
ALTER TABLE "JobBoardSource" ADD COLUMN "backoffUntil" DATETIME;
ALTER TABLE "JobBoardSource" ADD COLUMN "backoffStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobBoardSource" ADD COLUMN "note" TEXT;

-- Every board that has ever polled successfully is already seeded: its
-- postings are in JobPosting and were announced. A null seededAt means "the
-- next good poll seeds silently", which is right only for boards that have
-- never worked and for the repointed ones below.
-- Copied from lastSuccessAt so the value is stored the way Prisma stores dates.
UPDATE "JobBoardSource" SET "seededAt" = "lastSuccessAt" WHERE "lastSuccessAt" IS NOT NULL;

-- Repointed boards. The row is kept (company, tag, Poll and Email stay as
-- they were); only where it is read from changes. Health is cleared so the
-- panel shows the new board's first poll rather than the old board's error,
-- and seededAt is cleared so that first poll stamps everything it finds as
-- notified instead of emailing every role as "new". Postings from the old
-- board are left alone: they stop being seen and age out like those of any
-- removed board (STALE_AFTER_HOURS in lib/jobPostings.ts).
--
-- Guarded on the target not existing already, so this is safe if one was
-- added by hand; in that case the old row is a duplicate and is dropped.

-- Mercury: ashby:mercury returned nothing; greenhouse:mercury listed 77 roles on 2026-10-24.
UPDATE "JobBoardSource"
SET "provider" = 'greenhouse', "slug" = 'mercury', "seededAt" = NULL, "lastCheckedAt" = NULL,
    "lastSuccessAt" = NULL, "lastError" = NULL, "lastCount" = NULL,
    "backoffUntil" = NULL, "backoffStreak" = 0
WHERE "provider" = 'ashby' AND "slug" = 'mercury'
  AND NOT EXISTS (SELECT 1 FROM "JobBoardSource" WHERE "provider" = 'greenhouse' AND "slug" = 'mercury');
DELETE FROM "JobBoardSource" WHERE "provider" = 'ashby' AND "slug" = 'mercury';

-- Vercel: ashby:vercel returned nothing; greenhouse:vercel listed 95 roles on 2026-10-24.
UPDATE "JobBoardSource"
SET "provider" = 'greenhouse', "slug" = 'vercel', "seededAt" = NULL, "lastCheckedAt" = NULL,
    "lastSuccessAt" = NULL, "lastError" = NULL, "lastCount" = NULL,
    "backoffUntil" = NULL, "backoffStreak" = 0
WHERE "provider" = 'ashby' AND "slug" = 'vercel'
  AND NOT EXISTS (SELECT 1 FROM "JobBoardSource" WHERE "provider" = 'greenhouse' AND "slug" = 'vercel');
DELETE FROM "JobBoardSource" WHERE "provider" = 'ashby' AND "slug" = 'vercel';

-- Webflow: greenhouse:webflow returned nothing; ashby:webflow listed 17 roles on 2026-10-24.
UPDATE "JobBoardSource"
SET "provider" = 'ashby', "slug" = 'webflow', "seededAt" = NULL, "lastCheckedAt" = NULL,
    "lastSuccessAt" = NULL, "lastError" = NULL, "lastCount" = NULL,
    "backoffUntil" = NULL, "backoffStreak" = 0
WHERE "provider" = 'greenhouse' AND "slug" = 'webflow'
  AND NOT EXISTS (SELECT 1 FROM "JobBoardSource" WHERE "provider" = 'ashby' AND "slug" = 'webflow');
DELETE FROM "JobBoardSource" WHERE "provider" = 'greenhouse' AND "slug" = 'webflow';

-- HubSpot: greenhouse:hubspot returned nothing; greenhouse:hubspotjobs listed 65 roles on 2026-10-24.
UPDATE "JobBoardSource"
SET "provider" = 'greenhouse', "slug" = 'hubspotjobs', "seededAt" = NULL, "lastCheckedAt" = NULL,
    "lastSuccessAt" = NULL, "lastError" = NULL, "lastCount" = NULL,
    "backoffUntil" = NULL, "backoffStreak" = 0
WHERE "provider" = 'greenhouse' AND "slug" = 'hubspot'
  AND NOT EXISTS (SELECT 1 FROM "JobBoardSource" WHERE "provider" = 'greenhouse' AND "slug" = 'hubspotjobs');
DELETE FROM "JobBoardSource" WHERE "provider" = 'greenhouse' AND "slug" = 'hubspot';

-- Optiver: greenhouse:optiver returned nothing; greenhouse:optiverus listed 162 roles on 2026-10-24.
UPDATE "JobBoardSource"
SET "provider" = 'greenhouse', "slug" = 'optiverus', "seededAt" = NULL, "lastCheckedAt" = NULL,
    "lastSuccessAt" = NULL, "lastError" = NULL, "lastCount" = NULL,
    "backoffUntil" = NULL, "backoffStreak" = 0
WHERE "provider" = 'greenhouse' AND "slug" = 'optiver'
  AND NOT EXISTS (SELECT 1 FROM "JobBoardSource" WHERE "provider" = 'greenhouse' AND "slug" = 'optiverus');
DELETE FROM "JobBoardSource" WHERE "provider" = 'greenhouse' AND "slug" = 'optiver';

-- Old Mission Capital: greenhouse:oldmissioncapital returned nothing; ashby:old-mission-capital listed 39 roles on 2026-10-24.
UPDATE "JobBoardSource"
SET "provider" = 'ashby', "slug" = 'old-mission-capital', "seededAt" = NULL, "lastCheckedAt" = NULL,
    "lastSuccessAt" = NULL, "lastError" = NULL, "lastCount" = NULL,
    "backoffUntil" = NULL, "backoffStreak" = 0
WHERE "provider" = 'greenhouse' AND "slug" = 'oldmissioncapital'
  AND NOT EXISTS (SELECT 1 FROM "JobBoardSource" WHERE "provider" = 'ashby' AND "slug" = 'old-mission-capital');
DELETE FROM "JobBoardSource" WHERE "provider" = 'greenhouse' AND "slug" = 'oldmissioncapital';

-- Deel left Ashby (0 roles). The career-site scraper on mediabox already reads
-- deel.com/careers, which is why Deel was listed twice.
DELETE FROM "JobBoardSource" WHERE "provider" = 'ashby' AND "slug" = 'deel';

-- LinkedIn lists jobs only on linkedin.com, which forbids scraping and blocks
-- it; the Lever org "linkedin" is a test account. Switched off rather than
-- removed, so Jake decides.
UPDATE "JobBoardSource"
SET "enabled" = 0,
    "note" = 'No readable board: LinkedIn lists jobs only on linkedin.com, which forbids scraping (and the Lever org "linkedin" is a test account). Off until you decide; Remove it if it is not worth keeping.'
WHERE "provider" = 'greenhouse' AND "slug" = 'linkedin';
