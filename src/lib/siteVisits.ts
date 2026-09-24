/**
 * Visitor logging for the portfolio site.
 *
 * The collect endpoint is a public, unauthenticated write -- the same class of
 * exposure as account signup, and it needs the same treatment. An uncapped
 * endpoint that inserts a row per request is a free way to fill a SQLite file,
 * so writes are capped per address and old rows are pruned.
 */

import { prisma } from "./db";
import { locateMany } from "./geoip";
import { getJellyfinLoginSummary } from "./jellyfinLogins";

/** Allowed `site` values. An unknown site is rejected rather than stored. */
// "streamy" is this app reporting its own page views, alongside the portfolio
// beacon. Both flow through the same collect endpoint and store; the site field
// is what keeps them apart.
export const KNOWN_SITES = ["portfolio", "streamy"] as const;
export type KnownSite = (typeof KNOWN_SITES)[number];

/** Rows kept. Long enough to see a trend, short enough to stay small. */
export const RETENTION_DAYS = 90;

/** Per-address ceiling, so one client can't write unbounded rows. */
export const MAX_VISITS_PER_IP_PER_HOUR = 120;

export function isKnownSite(value: unknown): value is KnownSite {
  return typeof value === "string" && (KNOWN_SITES as readonly string[]).includes(value);
}

/**
 * Trims a value to a sane length before storage.
 *
 * These fields are attacker-controlled -- a beacon request can claim any path,
 * referrer, or user agent it likes -- so nothing is stored at whatever length
 * the client felt like sending.
 */
function clamp(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function recordVisit(input: {
  site: KnownSite;
  path: unknown;
  ip: string;
  country: string | null;
  referrer: unknown;
  userAgent: string | null;
}): Promise<"recorded" | "rate_limited" | "failed"> {
  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.siteVisit.count({
      where: { ip: input.ip, at: { gte: hourAgo } },
    });
    if (recent >= MAX_VISITS_PER_IP_PER_HOUR) return "rate_limited";

    await prisma.siteVisit.create({
      data: {
        site: input.site,
        path: clamp(input.path, 500) ?? "/",
        ip: input.ip.slice(0, 100),
        country: clamp(input.country, 10),
        referrer: clamp(input.referrer, 500),
        userAgent: clamp(input.userAgent, 500),
      },
    });
    return "recorded";
  } catch (err) {
    console.error("[siteVisits] failed to record:", err);
    return "failed";
  }
}

export async function pruneOldVisits(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    await prisma.siteVisit.deleteMany({ where: { at: { lt: cutoff } } });
  } catch (err) {
    console.error("[siteVisits] prune failed:", err);
  }
}

export type VisitorSummary = {
  visits24h: number;
  visits7d: number;
  uniqueVisitors7d: number;
  topPages: { path: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
  /**
   * The full visitor log: every page visit and every sign-in attempt we've kept
   * (within retention), newest first, as one merged timeline.
   */
  recent: {
    id: string;
    /**
     * "visit" for a page view, "login" for a sign-in attempt to this app,
     * "jellyfin" for a sign-in attempt to the Jellyfin server, "assistant"
     * for a turn taken with the admin assistant.
     */
    kind: "visit" | "login" | "jellyfin" | "assistant";
    /** "portfolio" | "streamy" for a visit; the kind's own label otherwise. */
    site: string;
    /**
     * The page path for a visit; "name: outcome" for either kind of sign-in;
     * the (truncated) prompt for an assistant turn.
     */
    path: string;
    /**
     * Empty string when the source genuinely has no address for the event.
     * Jellyfin sign-ins normally carry one for both outcomes; a row without
     * is an entry whose address couldn't be read, still worth listing.
     */
    ip: string;
    /** "City, Country" from GeoLite2, or null when it can't be placed. */
    location: string | null;
    referrer: string | null;
    /** Sign-in rows only (either kind): whether the attempt succeeded. */
    success?: boolean;
    at: string;
  }[];
  /** Total rows across both tables, so the panel can say if the log is capped. */
  totalActivity: number;
};

export async function getVisitorSummary(site: KnownSite = "portfolio"): Promise<VisitorSummary> {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  // Effectively "all" for a personal site inside 90-day retention, with a
  // safety ceiling so a pathological burst can't return an unbounded payload.
  const LOG_CAP = 1000;
  const [
    visits24h,
    visits7d,
    uniqueIps,
    pages,
    referrers,
    allVisits,
    allLogins,
    visitTotal,
    loginTotal,
    allAssistant,
    assistantTotal,
    jellyfinLogins,
  ] = await Promise.all([
    prisma.siteVisit.count({ where: { site, at: { gte: dayAgo } } }),
    prisma.siteVisit.count({ where: { site, at: { gte: weekAgo } } }),
    prisma.siteVisit.groupBy({ by: ["ip"], where: { site, at: { gte: weekAgo } } }),
    prisma.siteVisit.groupBy({
      by: ["path"],
      where: { site, at: { gte: weekAgo } },
      _count: { path: true },
      orderBy: { _count: { path: "desc" } },
      take: 5,
    }),
    prisma.siteVisit.groupBy({
      by: ["referrer"],
      where: { site, at: { gte: weekAgo }, referrer: { not: null } },
      _count: { referrer: true },
      orderBy: { _count: { referrer: "desc" } },
      take: 5,
    }),
    prisma.siteVisit.findMany({
      orderBy: { at: "desc" },
      take: LOG_CAP,
      select: { id: true, site: true, path: true, ip: true, referrer: true, at: true },
    }),
    prisma.loginAttempt.findMany({
      orderBy: { at: "desc" },
      take: LOG_CAP,
      select: { id: true, ip: true, name: true, success: true, outcome: true, at: true },
    }),
    prisma.siteVisit.count(),
    prisma.loginAttempt.count(),
    prisma.assistantUsage.findMany({
      orderBy: { at: "desc" },
      take: LOG_CAP,
      select: { id: true, actorName: true, backend: true, prompt: true, ip: true, at: true },
    }),
    prisma.assistantUsage.count(),
    // Live-fetched rather than stored: these are Jellyfin's own log, published
    // as a snapshot by the guard script on mediabox. Cached in
    // jellyfinLogins.ts, so the map and this log share one outbound read.
    getJellyfinLoginSummary(),
  ]);

  // One merged, newest-first timeline of everything.
  type Row = VisitorSummary["recent"][number] & { _at: Date };
  const rows: Row[] = [
    ...allVisits.map((v) => ({
      id: v.id,
      kind: "visit" as const,
      site: v.site,
      path: v.path,
      ip: v.ip,
      location: null,
      referrer: v.referrer,
      at: v.at.toISOString(),
      _at: v.at,
    })),
    ...allLogins.map((l) => ({
      id: l.id,
      kind: "login" as const,
      site: "login",
      path: `${l.name}: ${l.outcome}`,
      ip: l.ip,
      location: null,
      referrer: null,
      success: l.success,
      at: l.at.toISOString(),
      _at: l.at,
    })),
    ...allAssistant.map((a) => ({
      id: a.id,
      kind: "assistant" as const,
      site: "assistant",
      // Who asked and on which model, then what they asked -- the prompt is
      // already truncated at write time, so this is bounded.
      path: `${a.actorName} (${a.backend}): ${a.prompt}`,
      ip: a.ip,
      location: null,
      referrer: null,
      at: a.at.toISOString(),
      _at: a.at,
    })),
    ...jellyfinLogins.attempts.map((j) => ({
      // The snapshot has no ids of its own -- it is a rolling window of log
      // lines, so identity has to come from the event's own fields. Stable
      // enough for a React key, which is all it is used for.
      id: `jf:${j.at}:${j.user}:${j.ip ?? "noip"}`,
      kind: "jellyfin" as const,
      site: "jellyfin",
      path: `${j.user}: ${j.outcome}`,
      // Empty string rather than a fake address, so a row whose IP couldn't
      // be read lists honestly and the map simply skips it.
      ip: j.ip ?? "",
      location: null,
      referrer: null,
      success: j.outcome === "succeeded",
      at: j.at,
      _at: new Date(j.at),
    })),
  ]
    // A snapshot line with an unparseable timestamp would sort as NaN and
    // scramble the whole timeline, so drop those rather than trust them.
    .filter((r) => !Number.isNaN(r._at.getTime()))
    .sort((a, b) => b._at.getTime() - a._at.getTime())
    .slice(0, LOG_CAP);

  const located = await locateMany(rows.map((r) => r.ip));
  const locationOf = (ip: string): string | null => {
    const loc = located.get(ip);
    if (!loc) return null;
    if (loc.city && loc.country) return `${loc.city}, ${loc.country}`;
    return loc.country ?? loc.city ?? null;
  };

  return {
    visits24h,
    visits7d,
    uniqueVisitors7d: uniqueIps.length,
    topPages: pages.map((p) => ({ path: p.path, count: p._count.path })),
    topReferrers: referrers.map((r) => ({
      referrer: r.referrer ?? "(direct)",
      count: r._count.referrer,
    })),
    recent: rows.map(({ _at, ...r }) => ({ ...r, location: locationOf(r.ip) })),
    totalActivity: visitTotal + loginTotal + assistantTotal + jellyfinLogins.attempts.length,
  };
}
