-- AlterTable
ALTER TABLE "User" ADD COLUMN "password" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false;

-- Purge all existing users and their data, per explicit request. A fresh
-- admin account is created afterwards via normal signup (ADMIN_NAME
-- auto-approval, see src/lib/auth.ts) -- no seed data needed here.
DELETE FROM "MediaRequest";
DELETE FROM "EpisodeProgress";
DELETE FROM "WatchProgress";
DELETE FROM "WatchlistShowItem";
DELETE FROM "WatchlistItem";
DELETE FROM "User";
