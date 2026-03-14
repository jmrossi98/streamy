-- CreateTable
CREATE TABLE "EpisodeProgress" (
    "userId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "progressSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("userId", "showId", "seasonNumber", "episodeNumber"),
    CONSTRAINT "EpisodeProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
