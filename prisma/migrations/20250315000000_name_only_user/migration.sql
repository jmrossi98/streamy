-- Drop existing tables (order matters for SQLite FK)
DROP TABLE IF EXISTS "WatchProgress";
DROP TABLE IF EXISTS "WatchlistItem";
DROP TABLE IF EXISTS "User";

-- CreateTable User (name only)
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable WatchlistItem
CREATE TABLE "WatchlistItem" (
    "userId" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", "movieId"),
    CONSTRAINT "WatchlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable WatchProgress
CREATE TABLE "WatchProgress" (
    "userId" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "progressSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("userId", "movieId"),
    CONSTRAINT "WatchProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
