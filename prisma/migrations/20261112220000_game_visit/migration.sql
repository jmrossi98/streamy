-- A signed-in viewer opening a game's page, with the game's teams: what
-- pre-game prep learns followed teams from (gamePrepRules.ts).

-- CreateTable
CREATE TABLE "GameVisit" (
    "userId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "homeTeam" TEXT,
    "awayTeam" TEXT,
    "visitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "fixtureId")
);

-- CreateIndex
CREATE INDEX "GameVisit_visitedAt_idx" ON "GameVisit"("visitedAt");
