/**
 * Which wanted episodes nobody is going to search for. Pure.
 *
 * Every search Streamy starts goes through the ordered queue, and the queue
 * is written by the request that asked. When that write is lost the episodes
 * stay monitored and are never searched: Sonarr's RSS sync only sees new
 * releases, and the healer's idle pass is a slow trickle meant for the odd
 * episode a search missed. The Real Housewives of Atlanta lost its write to
 * the new-series race on 2026-10-12 and four hours later 272 of its episodes,
 * seasons 1 to 13, had still never been searched once.
 *
 * Sonarr records when each episode was last searched, so a lost write is
 * visible from the outside: wanted, never searched, and neither downloading
 * nor queued. Those go back into the ordered queue, whatever lost them.
 */

export type BacklogEpisode = {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  lastSearchTime?: string | null;
};

/**
 * How long before the same episode may be adopted again. A search that ran
 * stamps the episode and ends the matter; this only bounds the case where it
 * could not run, so the queue is not refilled on every ten-minute pass.
 */
export const READOPT_AFTER_MS = 6 * 60 * 60_000;

/**
 * Never-searched episodes to queue, per series, in broadcast order.
 *
 * Specials are left out for the reason the healer leaves them out: indexers
 * rarely carry them, and one explicitly asked for is queued by its request.
 *
 * @param busy      episode ids already downloading or already queued
 * @param adoptedAt when each episode id was last adopted, in ms
 */
export function unsearchedBacklog(
  wanted: BacklogEpisode[],
  busy: Set<number>,
  adoptedAt: Map<number, number>,
  now = Date.now()
): Map<number, number[]> {
  const bySeries = new Map<number, BacklogEpisode[]>();
  for (const e of wanted) {
    if (e.seasonNumber === 0 || e.lastSearchTime || busy.has(e.id)) continue;
    const last = adoptedAt.get(e.id);
    if (last != null && now - last < READOPT_AFTER_MS) continue;
    const list = bySeries.get(e.seriesId) ?? [];
    list.push(e);
    bySeries.set(e.seriesId, list);
  }
  const out = new Map<number, number[]>();
  for (const [seriesId, list] of bySeries) {
    list.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    out.set(seriesId, list.map((e) => e.id));
  }
  return out;
}
