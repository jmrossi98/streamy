-- One row per message sent to the admin assistant, so the visitors log can
-- show assistant use alongside page visits and sign-ins. Distinct from
-- AuditLogEntry, which records actions taken rather than questions asked.
CREATE TABLE "AssistantUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorName" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "country" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AssistantUsage_at_idx" ON "AssistantUsage"("at");
