/**
 * "Recently added" ordering for the Games library. Pure.
 *
 * A game still downloading, queued, or finished but not yet picked up by the
 * library scan has no added date -- nothing has been recorded for it yet. It
 * is nonetheless the newest thing on the page, so it sorts first, not last:
 * treating "no date" as "oldest" put every fresh download at the bottom
 * (reported 2026-10-03). Only a library game whose date is genuinely unknown
 * sorts last, since an unknown date is not a recent one.
 */
export type RecentSortable = {
  addedAt: string | null;
  status: string;
  jobId?: string | number | null;
  wishlistId?: string | number | null;
};

export function recentSortTime(item: RecentSortable): number {
  if (item.addedAt) {
    const t = Date.parse(item.addedAt);
    if (Number.isFinite(t)) return t;
  }
  const inFlight = item.status !== "library" || item.jobId != null || item.wishlistId != null;
  return inFlight ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

/** Newest first; ties (and two in-flight rows) fall back to the caller's tiebreak. */
export function compareRecent(a: RecentSortable, b: RecentSortable): number {
  const ta = recentSortTime(a);
  const tb = recentSortTime(b);
  if (ta === tb) return 0;
  return tb > ta ? 1 : -1;
}
