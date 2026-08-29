/**
 * Assembles the visitor map from its three sources, geolocating on the way.
 *
 * The three streams answer different questions and are kept distinct on the map:
 *  - portfolio: beacon visits to jakobrossi.com
 *  - streamy:   page views inside this app (authenticated users)
 *  - login:     sign-in attempts to this app, from LoginAttempt
 *
 * Login attempts matter precisely because they include access that never got
 * in -- the portfolio and page-view streams only ever show people who succeeded
 * at reaching a page, so they can't show a stranger rattling the door.
 *
 * This is the impure half (database + geo reader); the grouping and projection
 * it feeds are pure in visitorMap.ts.
 */

import { prisma } from "@/lib/db";
import { isDatabaseReady, isGeoipConfigured, locateMany } from "@/lib/geoip";
import {
  aggregatePins,
  totals,
  type LocatedVisit,
  type MapPin,
  type MapTotals,
} from "@/lib/visitorMap";

// A visit older than this isn't interesting on a "who is around" map, and
// bounding the query keeps the geolocation work proportional to recent traffic.
const WINDOW_DAYS = 90;

type RawVisit = { ip: string; city?: null; source: LocatedVisit["source"] };

export type VisitorMap = {
  configured: boolean;
  /** True once the database is present; false while it is still downloading. */
  ready: boolean;
  pins: MapPin[];
  totals: MapTotals;
  /** Visits that had an IP but no location (private/unknown), so counts reconcile. */
  unplaceable: number;
};

export async function getVisitorMap(): Promise<VisitorMap> {
  if (!isGeoipConfigured()) {
    return { configured: false, ready: false, pins: [], totals: emptyTotals(), unplaceable: 0 };
  }

  const ready = await isDatabaseReady();
  if (!ready) {
    // The database is still downloading; there is nothing to place yet. Say so
    // rather than querying and geolocating against a reader that will return
    // nothing.
    return { configured: true, ready: false, pins: [], totals: emptyTotals(), unplaceable: 0 };
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [siteVisits, logins] = await Promise.all([
    prisma.siteVisit.findMany({
      where: { at: { gte: since } },
      select: { ip: true, site: true },
    }),
    prisma.loginAttempt.findMany({
      where: { at: { gte: since } },
      select: { ip: true, success: true, at: true },
      orderBy: { at: "asc" },
    }),
  ]);

  // Classify each IP by the outcome of its MOST RECENT attempt, not per attempt.
  // An address that eventually got in (last attempt succeeded) is a real user
  // who had some failures along the way -- e.g. the sign-in loop bug -- not a
  // threat, so all of its attempts show as successful (green). An address whose
  // last attempt failed is still out, and stays amber. Rows are ordered oldest
  // first, so the last write per IP wins.
  const lastOutcomeByIp = new Map<string, boolean>();
  for (const l of logins) lastOutcomeByIp.set(l.ip, l.success);

  const raw: RawVisit[] = [
    ...siteVisits.map((v) => ({
      ip: v.ip,
      source: (v.site === "streamy" ? "streamy" : "portfolio") as LocatedVisit["source"],
    })),
    ...logins.map((l) => ({
      ip: l.ip,
      source: (lastOutcomeByIp.get(l.ip)
        ? "login-success"
        : "login-fail") as LocatedVisit["source"],
    })),
  ];

  const located = await locateMany(raw.map((r) => r.ip));

  const visits: LocatedVisit[] = [];
  let unplaceable = 0;
  for (const r of raw) {
    const loc = located.get(r.ip);
    if (!loc) {
      unplaceable += 1;
      continue;
    }
    visits.push({
      lat: loc.lat,
      lon: loc.lon,
      city: loc.city,
      country: loc.country,
      source: r.source,
    });
  }

  const pins = aggregatePins(visits);

  return {
    configured: true,
    ready: true,
    pins,
    totals: totals(pins),
    unplaceable,
  };
}

function emptyTotals(): MapTotals {
  return {
    pins: 0,
    visits: 0,
    bySource: { portfolio: 0, streamy: 0, "login-success": 0, "login-fail": 0 },
  };
}
