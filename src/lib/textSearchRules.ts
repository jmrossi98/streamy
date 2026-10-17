/**
 * The last search before a give-up: a plain text search across every indexer.
 * Pure.
 *
 * Sonarr asks indexers for an episode by its ids and numbers ("tvsearch"), and
 * some indexers answer that badly. Usenet Crawler answered 0 to every one of
 * Sonarr's tvsearch queries for the Real Housewives shows, while a plain text
 * search there found the releases at once -- RHOA S04E20 "Happiness and Joy"
 * existed nowhere else, and was given up on for it (2026-10-16). Jake: accept
 * any possible release before giving up.
 *
 * What is found is checked against Sonarr's/Radarr's own parser before it is
 * pushed, so a text hit is never grabbed for the wrong title. Blocklisted
 * releases stay blocked: a push goes through the decision engine.
 */

export type TextResult = {
  title: string;
  downloadUrl?: string | null;
  protocol?: string;
  seeders?: number | null;
  size?: number;
  publishDate?: string;
  indexer?: string;
};

/** "Show S04E20", then "Show Episode Title" -- the two forms release names take. */
export function episodeQueries(seriesTitle: string, season: number, episode: number, episodeTitle?: string | null): string[] {
  const se = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  const queries = [`${seriesTitle} ${se}`];
  // A generic title ("Episode 5", "TBA") would match half the indexer.
  if (episodeTitle && episodeTitle.length >= 6 && !/^(episode|tba|part)\b/i.test(episodeTitle)) {
    queries.push(`${seriesTitle} ${episodeTitle}`);
  }
  return queries;
}

/** "Movie 1999": the year keeps a remake or a namesake from flooding the results. */
export function movieQueries(title: string, year: number | null | undefined): string[] {
  return year ? [`${title} ${year}`] : [title];
}

/**
 * Worth a parse call: the name carries this exact episode (S04E20 or 4x20) and
 * no second one. Sonarr's parser decides for real; this only saves it a call
 * per unrelated result.
 */
export function namesEpisode(title: string, season: number, episode: number): boolean {
  const re = new RegExp(`(?:^|[^a-z0-9])(?:s0*${season}e0*${episode}|0*${season}x0*${episode})(?![0-9])(?!-?e\\d)`, "i");
  return re.test(title);
}

/** Usenet, or a torrent somebody seeds -- best first. */
export function rankTextResults<R extends TextResult>(results: R[]): R[] {
  return results
    .filter((r) => r.downloadUrl && (r.protocol === "usenet" || (r.seeders ?? 0) >= 1))
    .sort(
      (a, b) =>
        Number(b.protocol === "usenet") - Number(a.protocol === "usenet") ||
        (b.seeders ?? 0) - (a.seeders ?? 0) ||
        (b.size ?? 0) - (a.size ?? 0)
    );
}

/**
 * A quality tag for a release whose name carries none, guessed from its size
 * per minute of running time. Without one Sonarr/Radarr file it as "Unknown",
 * which no profile allows, and the push is refused. The guess only gets it
 * through the door: on import the quality is read from the file itself.
 *
 * From this library's own files (a ~42 minute episode): SD captures run
 * 0.35-1.0 GB (up to ~24 MB/min), 720p HDTV 1.2-1.5 GB (28-36 MB/min), 1080p
 * WEB-DL 2.5-3 GB (60+ MB/min).
 */
export function inferQualityTag(sizeBytes: number | undefined, runtimeMinutes: number | null | undefined): string {
  const minutes = runtimeMinutes && runtimeMinutes > 0 ? runtimeMinutes : 42;
  const mbPerMin = (sizeBytes ?? 0) / 1e6 / minutes;
  if (mbPerMin < 26) return "HDTV"; // no resolution: parsed as SDTV
  if (mbPerMin < 50) return "720p.HDTV";
  return "1080p.WEB-DL";
}

/** The name to push under: as found, or with a guessed tag when the parser saw no quality. */
export function pushTitle(title: string, parsedQuality: string | null | undefined, sizeBytes: number | undefined, runtimeMinutes: number | null | undefined): string {
  if (parsedQuality && parsedQuality.toLowerCase() !== "unknown") return title;
  return `${title}.${inferQualityTag(sizeBytes, runtimeMinutes)}`;
}

/** How often one title may get a text search: it spends a query on every indexer, some of which allow few. */
export const TEXT_SEARCH_EVERY_MS = 12 * 3600_000;
