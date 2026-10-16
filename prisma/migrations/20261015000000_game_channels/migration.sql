-- CreateTable
CREATE TABLE "GameChannel" (
    "channelId" INTEGER NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedSeenAt" DATETIME
);

-- CreateIndex
CREATE INDEX "GameChannel_fixtureId_idx" ON "GameChannel"("fixtureId");
