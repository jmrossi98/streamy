-- 2026-10-24: director/VP listings on Workday and on Greenhouse custom
-- domains are now read through the board's JSON. Read the ones that came
-- back unread again now, rather than after the 24-hour retry.
UPDATE "JobPosting"
SET "reqCheckedAt" = NULL, "reqStatus" = NULL, "hiddenReason" = 'Checking the listing''s requirements'
WHERE "reqStatus" = 'unread';
