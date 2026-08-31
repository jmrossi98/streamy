-- CreateTable
CREATE TABLE "PlaybackCheckRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "testTitle" TEXT,
    "durationMs" INTEGER,
    "notified" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "PlaybackCheckRun_ranAt_idx" ON "PlaybackCheckRun"("ranAt");
