-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN "lastPromptAt" DATETIME;

-- Existing chats keep their current place in the list.
UPDATE "ChatSession" SET "lastPromptAt" = "updatedAt";

-- CreateIndex
CREATE INDEX "ChatSession_userId_lastPromptAt_idx" ON "ChatSession"("userId", "lastPromptAt");
