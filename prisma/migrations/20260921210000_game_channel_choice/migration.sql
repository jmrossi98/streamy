-- Which channel a user picked for a given game, so a reload or a second
-- device doesn't re-tune to the best-guess channel they switched away from.
CREATE TABLE "GameChannelChoice" (
    "userId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pickedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "fixtureId"),
    CONSTRAINT "GameChannelChoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GameChannelChoice_userId_idx" ON "GameChannelChoice"("userId");
CREATE INDEX "GameChannelChoice_pickedAt_idx" ON "GameChannelChoice"("pickedAt");
