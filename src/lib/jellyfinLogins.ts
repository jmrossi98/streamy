/**
 * Recent Jellyfin sign-in attempts, for the admin security panel.
 *
 * Jellyfin runs on mediabox, not here, and is reached publicly through its
 * own Cloudflare tunnel rather than through this app -- see
 * docs/jellyfin-public-access.md in mediabox-infra. So this app has no
 * first-hand view of who's signing into it. mediabox's own
 * jellyfin_login_guard.py tails Jellyfin's log every 5 minutes and publishes
 * a snapshot, the same shape as the IPTV renewal dates in renewals.ts: read
 * over the tailnet from the flash container's nginx, best-effort, never
 * throwing.
 *
 * This module is a read-only view. It reports what mediabox already did --
 * it does not decide who gets blocked. That decision, and the Cloudflare API
 * call that enforces it, stay entirely on mediabox; see the script's own
 * header for why (the short version: this app can't see the attacker's real
 * connection either, for the same reason a local firewall on mediabox can't).
 *
 * The admin page reads this from three places in one render (the Security
 * panel's blocked-IP callout, the Visitors log, and the map) -- cached
 * briefly so that costs one outbound fetch, not three, the same reasoning
 * ttlCache.ts gives for the rest of the admin page's fan-out.
 */

import { cached } from "./ttlCache";

const PROBE_TIMEOUT_MS = 8_000;
// The publisher on mediabox refreshes every 5 minutes; a much shorter TTL
// here just multiplies requests to the flash container for no fresher data.
const CACHE_TTL_MS = 60_000;

export type JellyfinLoginAttempt = {
  at: string;
  outcome: "succeeded" | "failed";
  user: string;
  /** Null for a success -- Jellyfin's own log never carries an IP on that path. */
  ip: string | null;
};

export type JellyfinBlockedIp = {
  ip: string;
  sinceUtc: string;
};

export type JellyfinLoginSummary = {
  /** Null when the snapshot couldn't be read -- distinct from "read, but empty". */
  checkedUtc: string | null;
  /** Most recent first. */
  attempts: JellyfinLoginAttempt[];
  blocked: JellyfinBlockedIp[];
};

const EMPTY: JellyfinLoginSummary = { checkedUtc: null, attempts: [], blocked: [] };

export async function getJellyfinLoginSummary(): Promise<JellyfinLoginSummary> {
  return cached("jellyfin:logins", CACHE_TTL_MS, fetchJellyfinLoginSummary, {
    // A read that failed (unconfigured, unreachable, bad JSON) reports
    // checkedUtc: null. Caching that would turn one bad tailnet hiccup into a
    // minute of every panel on the page showing empty for no reason.
    skipCacheIf: (v) => v.checkedUtc === null,
  });
}

async function fetchJellyfinLoginSummary(): Promise<JellyfinLoginSummary> {
  const base = process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "");
  if (!base) return EMPTY;
  try {
    const res = await fetch(`${base}/status/jellyfin-logins.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    // A 404 means the guard script hasn't run yet -- not worth an alarming
    // row, same reasoning as the IPTV snapshot's own 404 handling.
    if (!res.ok) return EMPTY;

    const body = (await res.json()) as {
      checked_utc?: string;
      attempts?: {
        at?: string;
        outcome?: string;
        user?: string;
        ip?: string | null;
      }[];
      blocked?: { ip?: string; since_utc?: string }[];
    } | null;

    const attempts: JellyfinLoginAttempt[] = (body?.attempts ?? [])
      .filter(
        (a): a is { at: string; outcome: string; user: string; ip: string | null } =>
          typeof a.at === "string" &&
          typeof a.user === "string" &&
          (a.outcome === "succeeded" || a.outcome === "failed")
      )
      .map((a) => ({
        at: a.at,
        outcome: a.outcome as "succeeded" | "failed",
        user: a.user,
        ip: a.ip ?? null,
      }))
      // Most recent first -- the publisher appends in the order the log was
      // read, which is oldest first.
      .reverse();

    const blocked: JellyfinBlockedIp[] = (body?.blocked ?? [])
      .filter((b): b is { ip: string; since_utc: string } => typeof b.ip === "string" && typeof b.since_utc === "string")
      .map((b) => ({ ip: b.ip, sinceUtc: b.since_utc }));

    return { checkedUtc: body?.checked_utc ?? null, attempts, blocked };
  } catch {
    return EMPTY;
  }
}
