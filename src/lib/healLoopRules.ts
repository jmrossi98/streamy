/**
 * What keeps the download healer from going round in circles. Pure.
 *
 * ## The loop this ends
 *
 * The healer used to drop a stalled release *without* blocklisting it the
 * first time, on the theory that one stall is conditions rather than the
 * release. The search that followed then picked the same release again --
 * still the best-scoring one -- and the download client started it from zero.
 * The count that was supposed to blocklist it on the second stall lived in
 * memory and was pruned whenever the title was briefly out of the queue,
 * which is exactly the moment between the drop and the re-grab; a deploy
 * wiped it as well. So the second stall never arrived: Dances with Wolves
 * went 52% -> 3% -> 0% on the same torrent on 2026-10-04, and The Wire and
 * The Sopranos had done the same thing before it.
 *
 * ## The rules now
 *
 *  1. A release the healer drops is always blocklisted, so the search that
 *     follows cannot hand the same one back. (A merely stalled torrent is
 *     given time first -- see STALL_PATIENCE_MINUTES -- rather than dropped
 *     and re-fetched.)
 *  2. Every drop is written to the database, so nothing here is forgotten by
 *     a restart or a quiet moment in the queue.
 *  3. A release dropped twice inside a week stays blocklisted for that week,
 *     instead of coming back every time the ordinary blocklist expiry runs.
 *  4. A title that has burned through several releases in a day stops being
 *     fed new ones until tomorrow, and says so.
 */
import { sameRelease, type RejectedReleaseKey } from "./downloadHealthRules";

/** The `reason` a dropped-and-replaced release is recorded under. */
export const REPLACED_REASON = "replaced";

const DAY_MS = 24 * 3600_000;

/** How long drops are remembered for rule 3. */
export const REPEAT_WINDOW_MS = 7 * DAY_MS;
/** Drops of the same release, inside that window, before it stays blocked. */
export const REPEAT_BLOCK_AFTER = 2;
/** Releases one title may go through in a day before the healer stops replacing. */
export const MAX_REPLACEMENTS_PER_DAY = 4;

/** What a drop is counted against: a movie, one episode, or (no episode id) a series. */
export type HealScope = "movie" | "episode" | "show";

export type Replacement = {
  mediaType: string;
  externalId: number;
  releaseTitle: string;
  downloadId: string | null;
  createdAt: Date;
};

export function healScope(
  mediaType: "movie" | "show",
  entry: { externalId: number; episodeId?: number | null }
): { mediaType: HealScope; externalId: number } {
  if (mediaType === "movie") return { mediaType: "movie", externalId: entry.externalId };
  return entry.episodeId != null
    ? { mediaType: "episode", externalId: entry.episodeId }
    : { mediaType: "show", externalId: entry.externalId };
}

function isSame(a: Replacement, b: Replacement): boolean {
  return (
    (a.downloadId != null && b.downloadId != null && a.downloadId.toLowerCase() === b.downloadId.toLowerCase()) ||
    sameRelease(a.releaseTitle, b.releaseTitle)
  );
}

/** Releases dropped often enough that the blocklist expiry must leave them blocked. */
export function repeatOffenders(rows: readonly Replacement[], now = Date.now()): RejectedReleaseKey[] {
  const recent = rows.filter((r) => now - r.createdAt.getTime() <= REPEAT_WINDOW_MS);
  const out: RejectedReleaseKey[] = [];
  const counted = new Set<Replacement>();
  for (const row of recent) {
    if (counted.has(row)) continue;
    const same = recent.filter((other) => isSame(row, other));
    same.forEach((s) => counted.add(s));
    if (same.length >= REPEAT_BLOCK_AFTER) out.push({ releaseTitle: row.releaseTitle, downloadId: row.downloadId });
  }
  return out;
}

/** How many releases this title has been through in the last day. */
export function replacementsToday(
  rows: readonly Replacement[],
  scope: { mediaType: HealScope; externalId: number },
  now = Date.now()
): number {
  return rows.filter(
    (r) => r.mediaType === scope.mediaType && r.externalId === scope.externalId && now - r.createdAt.getTime() <= DAY_MS
  ).length;
}

export type HealDecision =
  /** Drop it, blocklist it, and search for another. */
  | "replace"
  /** Drop and blocklist it, but start no new search: the title is over its daily limit. */
  | "dropOnly"
  /** Leave it where it is. */
  | "leave";

/**
 * What to do with an unhealthy entry, given how many releases its title has
 * already been through today. Past the limit, a release that can still
 * finish (it is only stalled) is left to do so; one that cannot (failed, or
 * no seeder anywhere) is cleared out without fetching yet another.
 */
export function decideHeal(replacedToday: number, cannotFinish: boolean): HealDecision {
  if (replacedToday < MAX_REPLACEMENTS_PER_DAY) return "replace";
  return cannotFinish ? "dropOnly" : "leave";
}
