-- Admin becomes a stored role, account names become unique, and every sign-in
-- attempt is recorded.
--
-- Before this, admin was `token.name === process.env.ADMIN_NAME` evaluated
-- against the JWT, so the database had no say in who was an admin and the role
-- could not be revoked without waiting out a 30-day token. `isAdmin` is now the
-- authorization source of truth; ADMIN_NAME only bootstraps the first admin.

-- Every existing account starts non-admin. The first successful sign-in by
-- ADMIN_NAME promotes itself (see bootstrapAdminIfUnclaimed in lib/auth.ts),
-- which is how the existing admin regains the role without a manual step. SQL
-- cannot read environment variables, so this cannot be backfilled here.
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Names must be deduped before the unique index will build. Duplicates are
-- renamed rather than deleted: losing a real account to a migration is far
-- worse than an ugly name an admin can correct afterwards. The earliest row
-- for each name (lowest rowid) keeps the original.
UPDATE "User"
SET "name" = "name" || '-dup-' || substr("id", 1, 6)
WHERE rowid NOT IN (SELECT MIN(rowid) FROM "User" GROUP BY "name");

CREATE UNIQUE INDEX "User_name_key" ON "User"("name");

CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "outcome" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "LoginAttempt_name_at_idx" ON "LoginAttempt"("name", "at");
CREATE INDEX "LoginAttempt_ip_at_idx" ON "LoginAttempt"("ip", "at");
CREATE INDEX "LoginAttempt_at_idx" ON "LoginAttempt"("at");
