-- When a queued episode becomes eligible for an individual search.
--
-- A season request now searches its opening episodes one by one and the rest
-- in a single SeasonSearch. The batched episodes still need rows here, or the
-- admin panel cannot show them until something is grabbed; but the drain must
-- not search them individually while the batch is doing exactly that. Null
-- means "search when your turn comes", as before.
ALTER TABLE "PendingEpisodeSearch" ADD COLUMN "searchAfter" DATETIME;
