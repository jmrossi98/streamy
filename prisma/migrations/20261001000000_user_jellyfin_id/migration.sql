-- AlterTable
ALTER TABLE "User" ADD COLUMN "jellyfinUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_jellyfinUserId_key" ON "User"("jellyfinUserId");
