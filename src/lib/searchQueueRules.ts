/**
 * Which queued episode gets searched next.
 *
 * Separate from pendingEpisodeSearch.ts, which holds the rows, so the fairness
 * rule can be tested without a database -- the same split the other *Rules
 * modules use.
 */

export type QueuedSearch = {
  episodeId: number;
  seriesId: number;
  attempts: number;
};

/**
 * Picks the next episode, taking series in turn.
 *
 * `rows` must already be ordered by batch then position, so the first row for
 * any series is that series' next episode. That ordering is what keeps each
 * individual show arriving in episode order.
 *
 * Round-robin rather than one-season-at-a-time: a 64-episode season takes about
 * an hour to work through, and a show requested a minute later used to sit at
 * "starting" for all of it, indistinguishable from broken. Interleaving costs
 * each season some speed and gains every season a start.
 *
 * @param afterSeriesId the series served last; null to start from the earliest
 *                      requested.
 */
export function chooseNextSearch(
  rows: QueuedSearch[],
  afterSeriesId: number | null
): QueuedSearch | null {
  if (rows.length === 0) return null;

  // Series in the order they were first requested, so the rotation is stable
  // across calls rather than depending on row order within a series.
  const series: number[] = [];
  for (const row of rows) {
    if (!series.includes(row.seriesId)) series.push(row.seriesId);
  }

  // A series that has since left the queue gives indexOf -1, which lands the
  // rotation back at the start -- fair, and never stuck.
  const previous = afterSeriesId === null ? -1 : series.indexOf(afterSeriesId);
  for (let i = 1; i <= series.length; i += 1) {
    const seriesId = series[(previous + i + series.length) % series.length];
    const head = rows.find((row) => row.seriesId === seriesId);
    if (head) return head;
  }
  return null;
}
