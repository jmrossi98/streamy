-- AlterTable
ALTER TABLE "FlashGame" ADD COLUMN "andkonPath" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FlashGame_andkonPath_key" ON "FlashGame"("andkonPath");
