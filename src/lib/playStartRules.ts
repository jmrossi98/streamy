/**
 * Where a show's Play button starts when there is no watch progress. Pure.
 *
 * The earliest episode actually on disk, not S1E1: a show with only its latest
 * season downloaded should offer that season, not an episode that can't play.
 * Specials (season 0) are skipped -- they are not where a show starts.
 */
export function earliestDownloaded<E extends { seasonNumber: number; episodeNumber: number; hasFile: boolean }>(
  episodes: E[]
): { seasonNumber: number; episodeNumber: number } | null {
  let best: E | null = null;
  for (const ep of episodes) {
    if (!ep.hasFile || ep.seasonNumber < 1) continue;
    if (
      !best ||
      ep.seasonNumber < best.seasonNumber ||
      (ep.seasonNumber === best.seasonNumber && ep.episodeNumber < best.episodeNumber)
    ) {
      best = ep;
    }
  }
  return best ? { seasonNumber: best.seasonNumber, episodeNumber: best.episodeNumber } : null;
}
