-- CreateTable
CREATE TABLE "HiddenChannelItem" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hiddenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "channelId"),
    CONSTRAINT "HiddenChannelItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HiddenChannelItem_userId_idx" ON "HiddenChannelItem"("userId");
