-- One row per scheduled health-probe run. Separate from PlaybackCheckRun
-- rather than sharing a table: that one records a single end-to-end journey
-- with ordered stages, this records a set of independent assertions, and
-- merging them would mean a nullable column per difference plus a `kind`
-- discriminator on every query.
CREATE TABLE "HealthProbeRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "durationMs" INTEGER,
    -- False when the failure alert was skipped or failed to send, so a
    -- silent alert shows in the panel rather than being assumed to have gone.
    "notified" BOOLEAN NOT NULL DEFAULT false,
    -- What automatic remediation actually did, newline-separated. Null when
    -- nothing was attempted, which is the common case.
    "remediated" TEXT
);
CREATE INDEX "HealthProbeRun_ranAt_idx" ON "HealthProbeRun"("ranAt");
