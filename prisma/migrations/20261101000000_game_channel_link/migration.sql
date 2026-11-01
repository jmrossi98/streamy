-- A channel already in the lineup, linked to a game from its page: listed on
-- that game's page like a feed added for it, but never removed after the game
-- (only GameChannel rows are, by the cleanup pass).

-- CreateTable
CREATE TABLE "GameChannelLink" (
    "fixtureId" TEXT NOT NULL,
    "channelId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("fixtureId", "channelId")
);

-- CreateIndex
CREATE INDEX "GameChannelLink_createdAt_idx" ON "GameChannelLink"("createdAt");
