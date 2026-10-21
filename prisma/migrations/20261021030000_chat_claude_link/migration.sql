-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN "claudeSessionId" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN "claudeSeenTurns" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ChatSession_claudeSessionId_idx" ON "ChatSession"("claudeSessionId");
