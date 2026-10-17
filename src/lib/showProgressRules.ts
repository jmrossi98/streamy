/**
 * The red progress bar on a show's tile: how far into the episode the viewer
 * last stopped in, the way the movie tiles show the movie.
 */
export type ShowProgress = {
  seasonNumber: number;
  episodeNumber: number;
  progressSeconds: number;
  runtimeMinutes: number | null;
};

type EpisodeRow = {
  showId: string;
  seasonNumber: number;
  episodeNumber: number;
  progressSeconds: number;
  updatedAt: Date;
};

/** The most recently watched episode of each show, if any of it was watched. */
export function latestEpisodePerShow(
  rows: EpisodeRow[]
): Record<string, Omit<ShowProgress, "runtimeMinutes">> {
  const best = new Map<string, EpisodeRow>();
  for (const r of rows) {
    const cur = best.get(r.showId);
    if (!cur || r.updatedAt.getTime() > cur.updatedAt.getTime()) best.set(r.showId, r);
  }
  const out: Record<string, Omit<ShowProgress, "runtimeMinutes">> = {};
  for (const [id, r] of best) {
    if (r.progressSeconds <= 0) continue;
    out[id] = { seasonNumber: r.seasonNumber, episodeNumber: r.episodeNumber, progressSeconds: r.progressSeconds };
  }
  return out;
}

/** Percent through the episode, or null when its length is unknown (no bar then). */
export function showProgressPercent(p: ShowProgress): number | null {
  if (!p.runtimeMinutes || p.runtimeMinutes <= 0) return null;
  return Math.min(100, Math.round((p.progressSeconds / (p.runtimeMinutes * 60)) * 100));
}

export function showProgressLabel(p: ShowProgress): string {
  return `Resume · S${p.seasonNumber}:E${p.episodeNumber}`;
}
