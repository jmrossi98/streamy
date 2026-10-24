-- CreateTable
CREATE TABLE "IptvLineExpiry" (
    "accountId" INTEGER NOT NULL,
    "lineId" INTEGER NOT NULL,
    "lineName" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("accountId", "lineId")
);
