-- CreateTable
CREATE TABLE "FlashGame" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "flashpointId" TEXT,
    "developer" TEXT NOT NULL DEFAULT '',
    "publisher" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "releaseDate" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "frameRate" REAL NOT NULL DEFAULT 0,
    "swfVersion" INTEGER NOT NULL DEFAULT 0,
    "isActionScript3" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WatchlistFlashGameItem" (
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "slug"),
    CONSTRAINT "WatchlistFlashGameItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchlistFlashGameItem_slug_fkey" FOREIGN KEY ("slug") REFERENCES "FlashGame" ("slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FlashGame_title_idx" ON "FlashGame"("title");

-- CreateIndex
CREATE INDEX "WatchlistFlashGameItem_userId_idx" ON "WatchlistFlashGameItem"("userId");
