-- CreateTable
CREATE TABLE "LiveChannelState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "clearedAt" DATETIME,
    "clearedBy" TEXT,
    "alertedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
