-- Optional grouping for a watched board, e.g. "startup".
--
-- A six-person startup and Nvidia are not the same kind of listing even when
-- the role title matches, so the panel needs a way to separate them that is
-- about the company rather than the job.
ALTER TABLE "JobBoardSource" ADD COLUMN "tag" TEXT;
