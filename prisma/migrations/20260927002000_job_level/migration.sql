-- Seniority as the title implies it. Unmarked titles default to midsenior by
-- convention: a plain "Software Engineer" is an ordinary IC posting nearly
-- everywhere, and a fourth "unspecified" bucket would hold most of the rows
-- and make the filter useless.
ALTER TABLE "JobPosting" ADD COLUMN "level" TEXT NOT NULL DEFAULT 'midsenior';
CREATE INDEX "JobPosting_level_idx" ON "JobPosting"("level");
