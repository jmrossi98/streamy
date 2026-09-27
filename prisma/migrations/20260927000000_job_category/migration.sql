-- Which kind of role a posting is: software, quant, firmware, security, and so
-- on. Defaulted rather than nullable so existing rows stay valid; they are
-- re-classified as they are re-polled, which is every half hour.
ALTER TABLE "JobPosting" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'swe';
CREATE INDEX "JobPosting_category_idx" ON "JobPosting"("category");
