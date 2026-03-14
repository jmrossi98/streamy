-- CreateTable
CREATE TABLE "WatchlistShowItem" (
    "userId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "showId"),
    CONSTRAINT "WatchlistShowItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
