-- CreateTable
CREATE TABLE "ViewerSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT,
    "path" TEXT,
    "playing" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlaybackEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "media" TEXT NOT NULL,
    "detail" TEXT,
    "ms" INTEGER
);

-- CreateIndex
CREATE INDEX "ViewerSession_lastSeenAt_idx" ON "ViewerSession"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ViewerSession_userId_lastSeenAt_idx" ON "ViewerSession"("userId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "PlaybackEvent_at_idx" ON "PlaybackEvent"("at");

-- CreateIndex
CREATE INDEX "PlaybackEvent_sessionId_at_idx" ON "PlaybackEvent"("sessionId", "at");
