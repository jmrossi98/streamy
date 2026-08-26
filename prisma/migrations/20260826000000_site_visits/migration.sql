-- Visits to the portfolio site, reported by a beacon on that site.
--
-- The portfolio is a static SPA on GitHub Pages with no server, so it has
-- nowhere to log; the beacon posts here instead.
CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "site" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "country" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SiteVisit_at_idx" ON "SiteVisit"("at");
CREATE INDEX "SiteVisit_site_at_idx" ON "SiteVisit"("site", "at");
CREATE INDEX "SiteVisit_ip_at_idx" ON "SiteVisit"("ip", "at");
