-- CreateTable
CREATE TABLE "GameTitleOverride" (
    "system" TEXT NOT NULL,
    "romStem" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("system", "romStem")
);
