-- Ordered season/series searches, persisted so they survive a restart.
--
-- The chain that searches a season one episode at a time, in broadcast order,
-- runs for the better part of an hour on a long season. It used to exist only
-- in the serving process's memory, so a deploy part-way through silently
-- dropped every remaining episode: episode 1 downloaded, the rest stayed
-- monitored and never searched again (Sonarr's RSS sync only catches new
-- releases, so nothing recovered them).
CREATE TABLE "PendingEpisodeSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episodeId" INTEGER NOT NULL,
    "seriesId" INTEGER NOT NULL,
    -- Index within the enqueued batch. Episode ids are not in airing order,
    -- so without this the order is lost the moment the queue is reloaded.
    "position" INTEGER NOT NULL,
    "enqueuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Bumped on failure so one broken episode is dropped rather than blocking
    -- everything queued behind it.
    "attempts" INTEGER NOT NULL DEFAULT 0
);
-- Unique so re-requesting a season that is already queued tops it up instead
-- of searching anything twice.
CREATE UNIQUE INDEX "PendingEpisodeSearch_episodeId_key" ON "PendingEpisodeSearch"("episodeId");
CREATE INDEX "PendingEpisodeSearch_enqueuedAt_position_idx" ON "PendingEpisodeSearch"("enqueuedAt", "position");
