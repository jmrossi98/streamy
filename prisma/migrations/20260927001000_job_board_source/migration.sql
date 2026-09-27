-- Company boards the job watcher polls.
--
-- Was a single JOB_BOARD_SOURCES env var, so adding a company meant editing a
-- secret and waiting for a deploy. Held here it is editable from the admin
-- panel and takes effect on the next poll. The env var still seeds a fresh
-- install; rows here win once any exist.
CREATE TABLE "JobBoardSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    -- Keep the row but stop polling it, for a board that has started failing.
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    -- A company can be worth listing without being worth an email.
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "JobBoardSource_provider_slug_key" ON "JobBoardSource"("provider", "slug");
CREATE INDEX "JobBoardSource_enabled_idx" ON "JobBoardSource"("enabled");
