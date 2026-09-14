-- CreateTable
CREATE TABLE "FlashGameSave" (
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "slug"),
    CONSTRAINT "FlashGameSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FlashGameSave_slug_fkey" FOREIGN KEY ("slug") REFERENCES "FlashGame" ("slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FlashGameSave_userId_idx" ON "FlashGameSave"("userId");
