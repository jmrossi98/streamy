-- CreateTable
CREATE TABLE "GameFirstSeen" (
    "system" TEXT NOT NULL,
    "romStem" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("system", "romStem")
);
