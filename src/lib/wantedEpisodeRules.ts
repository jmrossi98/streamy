/**
 * Which of a requested show's episodes are still owed. Pure.
 *
 * The downloads panel used to list an episode only once something else had a
 * row for it: Streamy's own search queue, or Sonarr's download queue. A whole
 * show whose search queue was never written -- The Real Housewives of Atlanta,
 * 405 episodes -- therefore showed only the 22 episodes Sonarr happened to
 * have grabbed, all from season 17, and nothing for the other sixteen seasons
 * that were just as much asked for.
 *
 * What was asked for is not in doubt: Sonarr marks it. A monitored episode
 * that has aired and has no file is wanted, whoever is or is not searching for
 * it at this moment, so the panel lists those too.
 */

export type EpisodeForWanted = {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string | null;
  monitored: boolean;
  hasFile: boolean;
  airDateUtc?: string | null;
};

export type WantedEpisode = { episodeId: number; seasonNumber: number; episodeNumber: number; title: string };

/**
 * Monitored, aired, not on disk. An episode with no air date has not been
 * scheduled, and one dated in the future cannot be downloaded yet; neither is
 * something the panel should promise.
 */
export function wantedEpisodes(episodes: EpisodeForWanted[], now = Date.now()): WantedEpisode[] {
  return episodes
    .filter((e) => {
      if (!e.monitored || e.hasFile || !e.airDateUtc) return false;
      const aired = Date.parse(e.airDateUtc);
      return Number.isFinite(aired) && aired <= now;
    })
    .map((e) => ({
      episodeId: e.id,
      seasonNumber: e.seasonNumber,
      episodeNumber: e.episodeNumber,
      title: e.title ?? "",
    }));
}

/** The label the search queue's own rows use, so the two read alike. */
export function episodeLabel(seriesTitle: string, e: Pick<WantedEpisode, "seasonNumber" | "episodeNumber" | "title">): string {
  return `${seriesTitle} - S${e.seasonNumber} E${e.episodeNumber}${e.title ? ` - ${e.title}` : ""}`;
}

/**
 * Reads the show, season and episode back out of an episodeLabel.
 *
 * The panel places a row by asking Sonarr for the show's episode list. When
 * Sonarr is too busy to answer, every row of the show landed under "Other"
 * although each one says where it belongs in its own name: Vanderpump Rules,
 * 261 queued episodes, all in one unnumbered bucket.
 */
export function placeFromLabel(label: string): { seriesTitle: string; seasonNumber: number; episodeNumber: number } | null {
  const m = /^(.+?) - S(\d+) E(\d+)(?: - |$)/.exec(label);
  if (!m) return null;
  return { seriesTitle: m[1], seasonNumber: Number(m[2]), episodeNumber: Number(m[3]) };
}

/**
 * What asking for a whole show asks for: every regular episode not on disk,
 * in broadcast order. Never the specials (season 0) -- see
 * searchSeriesInEpisodeOrder in sonarr.ts.
 */
export function wholeShowEpisodes<T extends { seasonNumber: number; episodeNumber: number; hasFile: boolean }>(episodes: T[]): T[] {
  return episodes
    .filter((e) => !e.hasFile && e.seasonNumber !== 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
}
