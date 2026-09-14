-- CreateTable
CREATE TABLE "WatchlistChannelItem" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "channelId"),
    CONSTRAINT "WatchlistChannelItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WatchlistChannelItem_userId_idx" ON "WatchlistChannelItem"("userId");

