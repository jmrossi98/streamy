-- CreateTable
CREATE TABLE "GameArtwork" (
    "system" TEXT NOT NULL,
    "romStem" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "sgdbGameId" INTEGER,
    "title" TEXT,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("system", "romStem", "kind")
);
