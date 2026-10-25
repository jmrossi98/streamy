-- 2026-10-24: every Streamy login set the Jellyfin password, which signs out
-- the Roku and phone apps. Record when it was last pushed so it is set again
-- only after a password change.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "jellyfinPasswordSyncedAt" DATETIME;
