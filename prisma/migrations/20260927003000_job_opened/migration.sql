-- When a listing was last opened from the panel.
--
-- Server-side rather than relying on browser history: what has already been
-- explored is a fact about the search, not about one browser, so it should
-- survive a different device and a cleared cache.
ALTER TABLE "JobPosting" ADD COLUMN "openedAt" DATETIME;
CREATE INDEX "JobPosting_openedAt_idx" ON "JobPosting"("openedAt");
