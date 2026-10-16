/**
 * When to stop wanting a title nothing can be found for. Pure.
 *
 * Jake, 2026-10-16, with nineteen Housewives episodes sitting at "queued" for
 * days: "if we can't find releases after a certain point we should just stop
 * the download. i dont want it to hang for days." Until now a title no
 * indexer carried was re-searched for ever, on a backoff that capped at eight
 * hours (see idleBackoffMs), so the panel never said anything but "queued".
 *
 * Giving up means unmonitoring the episode or movie: Sonarr and Radarr stop
 * wanting it, the healer stops re-searching it, and the panel says so for a
 * few days. Asking for it again starts the count over.
 *
 * The ledger (wantedSearches.ts) counts the healer's re-searches durably. The
 * in-memory try counter that drives the backoff resets on every deploy, which
 * is several times a day, so it cannot say how long something has been tried.
 */

export type SearchLedgerEntry = {
  firstSearchedAt: Date;
  lastSearchedAt: Date;
  searches: number;
  gaveUpAt: Date | null;
};

export type ReleaseInfo = {
  /** False for a movie not out yet; it is kept wanted however long that takes. */
  released?: boolean;
  /** When it aired or came out, if known. */
  releasedAt?: Date | null;
};

/** How long a title is re-searched before it is given up on. */
export const GIVE_UP_AFTER_MS = 24 * 3600_000;
/**
 * And at least this many real searches in that time. The clock alone would
 * give up on everything wanted during a day-long Sonarr outage.
 */
export const GIVE_UP_MIN_SEARCHES = 6;
/**
 * A title that came out this recently keeps being wanted: releases of a new
 * episode trickle in over the week after it airs.
 */
export const RELEASE_GRACE_MS = 7 * 24 * 3600_000;
/** How long a given-up title stays on the downloads panel. */
export const GIVE_UP_SHOWN_MS = 3 * 24 * 3600_000;

export function shouldGiveUp(
  entry: SearchLedgerEntry | null | undefined,
  release: ReleaseInfo = {},
  now: number = Date.now()
): boolean {
  if (!entry || entry.gaveUpAt) return false;
  if (entry.searches < GIVE_UP_MIN_SEARCHES) return false;
  if (now - entry.firstSearchedAt.getTime() < GIVE_UP_AFTER_MS) return false;
  if (release.released === false) return false;
  if (release.releasedAt && now - release.releasedAt.getTime() < RELEASE_GRACE_MS) return false;
  return true;
}

function days(ms: number): string {
  const d = Math.max(1, Math.round(ms / 86_400_000));
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** For the log and the audit trail: "gave up after 2 days: no release found in 9 searches". */
export function giveUpReason(entry: SearchLedgerEntry, now: number = Date.now()): string {
  return `gave up after ${days(now - entry.firstSearchedAt.getTime())}: no release found in ${entry.searches} searches`;
}

/** The line under a given-up row on the downloads panel. */
export function giveUpNotice(entry: SearchLedgerEntry): string {
  const tried = entry.gaveUpAt ? entry.gaveUpAt.getTime() - entry.firstSearchedAt.getTime() : GIVE_UP_AFTER_MS;
  return `Gave up after ${days(tried)}: no indexer had a usable release. Retry to search again.`;
}

/** Whether a given-up title is still recent enough to list. */
export function stillShown(entry: SearchLedgerEntry, now: number = Date.now()): boolean {
  return entry.gaveUpAt != null && now - entry.gaveUpAt.getTime() < GIVE_UP_SHOWN_MS;
}

export type RetryTarget = { mediaType: "movie" | "show"; externalId: number; episodeId?: number | null; gaveUp?: boolean };

/**
 * What an admin's Retry asks Radarr and Sonarr for: the given-up movies, and
 * the given-up episodes grouped per show (one search command per show). Rows
 * that were not given up on, and show rows with no episode, are left out:
 * there is nothing to un-give-up, and a whole-show search was never the ask.
 */
export function retryTargets(rows: RetryTarget[]): { movies: number[]; episodes: Map<number, number[]> } {
  const movies = new Set<number>();
  const episodes = new Map<number, number[]>();
  for (const r of rows) {
    if (!r.gaveUp) continue;
    if (r.mediaType === "movie") movies.add(r.externalId);
    else if (r.episodeId != null) {
      const ids = episodes.get(r.externalId) ?? [];
      if (!ids.includes(r.episodeId)) ids.push(r.episodeId);
      episodes.set(r.externalId, ids);
    }
  }
  return { movies: [...movies], episodes };
}
