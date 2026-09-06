-- CreateTable
CREATE TABLE "GameDeletion" (
    "system" TEXT NOT NULL,
    "romStem" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,

    PRIMARY KEY ("system", "romStem")
);
