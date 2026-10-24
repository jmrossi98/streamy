-- 2026-10-24: the first director/VP requirement reads tied "10+ years ...,
-- including 5+ years managing managers" all to managing managers. The
-- extractor now reads each number with its own words; read every listing
-- again (a handful of rows; 3 per poll). Hidden until re-read.
UPDATE "JobPosting"
SET "reqCheckedAt" = NULL, "reqStatus" = NULL, "reqYears" = NULL, "reqManagerYears" = NULL,
    "hiddenReason" = 'Checking the listing''s requirements'
WHERE "reqCheckedAt" IS NOT NULL;
