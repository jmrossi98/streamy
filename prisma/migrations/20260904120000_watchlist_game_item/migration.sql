-- CreateTable
CREATE TABLE "WatchlistGameItem" (
    "userId" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "gameKey"),
    CONSTRAINT "WatchlistGameItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WatchlistGameItem_userId_idx" ON "WatchlistGameItem"("userId");
