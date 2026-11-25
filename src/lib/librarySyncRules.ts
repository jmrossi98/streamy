/**
 * How often a title page re-checks for its Play button after the download
 * finishes. Pure.
 *
 * "Downloaded" is the *arr's word; playable is Jellyfin's, and its scan of the
 * new file can trail the import by seconds or by minutes on a busy box (see
 * streamy-import-index-race). The page used to retry for about 40 seconds and
 * then hand the job to the viewer -- "Still syncing to the library - tap to
 * check again". Jake, 2026-11-25: "when titles are done downloading, can we
 * refresh ourselves instead of asking the user to?" So it keeps checking for
 * as long as the page is open: quickly at first, when the swap usually lands,
 * then at a steady pace, then slowly once it has clearly stalled.
 */

/** The first few checks, while the scan is most likely to land. */
const RAMP_MS = [1500, 3000, 6000, 12_000];
/** Then this often, for the first ten minutes or so. */
const STEADY_MS = 15_000;
const STEADY_CHECKS = 40;
/** After that the scan has stalled; keep looking, but gently. */
const SLOW_MS = 60_000;

/** Wait before check number `attempt` (0-based). */
export function librarySyncDelayMs(attempt: number): number {
  if (attempt < RAMP_MS.length) return RAMP_MS[attempt];
  if (attempt < RAMP_MS.length + STEADY_CHECKS) return STEADY_MS;
  return SLOW_MS;
}

/** Past this many checks the wait is long enough to say so (still without asking for anything). */
export const LIBRARY_SYNC_SLOW_AFTER = RAMP_MS.length + STEADY_CHECKS;
