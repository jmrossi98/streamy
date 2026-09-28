-- The display name of a queued episode, e.g. "South Park - S1 E3 - Volcano".
--
-- Stored because resolving it at render time needs Sonarr, and the admin
-- panel is opened exactly when Sonarr is busiest: rows rendered as
-- "Episode 1624". The name never changes, so it is written once, when the
-- request is made and Sonarr is by definition answering.
ALTER TABLE "PendingEpisodeSearch" ADD COLUMN "label" TEXT;
