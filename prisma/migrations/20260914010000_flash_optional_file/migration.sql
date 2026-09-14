-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FlashGame" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "flashpointId" TEXT,
    "developer" TEXT NOT NULL DEFAULT '',
    "publisher" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "releaseDate" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "storage" TEXT,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "frameRate" REAL NOT NULL DEFAULT 0,
    "swfVersion" INTEGER NOT NULL DEFAULT 0,
    "isActionScript3" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_FlashGame" ("addedAt", "description", "developer", "fileName", "fileSize", "flashpointId", "frameRate", "height", "isActionScript3", "publisher", "releaseDate", "slug", "swfVersion", "tags", "title", "width") SELECT "addedAt", "description", "developer", "fileName", "fileSize", "flashpointId", "frameRate", "height", "isActionScript3", "publisher", "releaseDate", "slug", "swfVersion", "tags", "title", "width" FROM "FlashGame";
DROP TABLE "FlashGame";
ALTER TABLE "new_FlashGame" RENAME TO "FlashGame";
CREATE UNIQUE INDEX "FlashGame_flashpointId_key" ON "FlashGame"("flashpointId");
CREATE INDEX "FlashGame_title_idx" ON "FlashGame"("title");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

