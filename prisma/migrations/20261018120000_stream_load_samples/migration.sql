-- CreateTable
CREATE TABLE "StreamLoadSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playing" INTEGER NOT NULL,
    "live" INTEGER NOT NULL,
    "vod" INTEGER NOT NULL,
    "proxyMbps" REAL NOT NULL,
    "torrentUpMbps" REAL
);

-- CreateIndex
CREATE INDEX "StreamLoadSample_at_idx" ON "StreamLoadSample"("at");
