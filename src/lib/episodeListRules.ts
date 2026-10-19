/**
 * Which of a season's episodes to list, and which of those have not aired.
 *
 * TMDB fills a season out ahead of time with placeholder rows -- "Episode 4",
 * no synopsis, no still, often no air date -- for episodes it knows exist but
 * nothing else about. Listed, they read as something to download, and the
 * Download button on one sends a search that cannot succeed. A row with no
 * information behind it is dropped, unless Sonarr already has something for
 * it (on disk, downloading, or asked for), which the person would otherwise
 * lose sight of.
 *
 * An episode TMDB does describe but which has not aired is listed and marked
 * "Not aired yet", instead of "No release found": a search that comes up
 * empty for an episode that does not exist yet is the expected outcome, not
 * a dead end.
 */

export type ListedEpisode = {
  episodeNumber: number;
  name: string;
  overview: string;
  /** True when TMDB has a still for the episode (not the placeholder art). */
  hasStill: boolean;
  /** YYYY-MM-DD, or null when TMDB has no date for it. */
  airDate: string | null;
};

/** TMDB's stand-in name for an episode it knows nothing about. */
const PLACEHOLDER_NAME = /^episode\s+\d+$/i;

/** True when TMDB says something about the episode beyond its number. */
export function hasEpisodeInfo(ep: ListedEpisode): boolean {
  if (ep.overview.trim()) return true;
  if (ep.hasStill) return true;
  const name = ep.name.trim();
  return name !== "" && !PLACEHOLDER_NAME.test(name);
}

/**
 * True when the episode's air date is after `today` (both YYYY-MM-DD). An
 * episode with no date is not called unaired: it may well be out, TMDB just
 * does not know when.
 */
export function isUnaired(ep: Pick<ListedEpisode, "airDate">, today: string): boolean {
  return ep.airDate !== null && ep.airDate > today;
}

/**
 * The episodes worth listing: everything with information behind it, plus any
 * placeholder Sonarr already tracks (`tracked` holds those episode numbers).
 */
export function listableEpisodes<T extends ListedEpisode>(episodes: T[], tracked: Iterable<number>): T[] {
  const kept = new Set(tracked);
  return episodes.filter((ep) => kept.has(ep.episodeNumber) || hasEpisodeInfo(ep));
}

/** Today's date as YYYY-MM-DD in the viewer's own time zone. */
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
