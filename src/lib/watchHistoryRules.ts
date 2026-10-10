/**
 * Watch history: what a person has watched and when. Pure.
 *
 * There is no separate history log. The progress tables already hold one row
 * per movie and per episode a person has played, stamped each time the
 * position is saved, so the history is those rows read newest first: one entry
 * per title, dated by when it was last watched.
 */

export type HistoryTarget =
  | { kind: "movie"; movieId: string }
  | { kind: "episode"; showId: string; season: number; episode: number }
  | { kind: "all" };

export type HistoryRow =
  | { kind: "movie"; movieId: string; seconds: number; at: Date }
  | { kind: "episode"; showId: string; season: number; episode: number; seconds: number; at: Date };

export const HISTORY_PAGE = 30;
export const HISTORY_PAGE_MAX = 100;

/**
 * One page of the two tables read as a single list, newest first.
 *
 * Each list must already be newest first and hold at least `offset + limit + 1`
 * rows (or all there are), which is what makes `hasMore` trustworthy.
 */
export function historyPage(
  movies: HistoryRow[],
  episodes: HistoryRow[],
  offset: number,
  limit: number
): { rows: HistoryRow[]; hasMore: boolean } {
  const all = [...movies, ...episodes].sort((a, b) => b.at.getTime() - a.at.getTime());
  return { rows: all.slice(offset, offset + limit), hasMore: all.length > offset + limit };
}

/** Paging values from a query string, clamped to something sane. */
export function historyPaging(offset: string | null, limit: string | null): { offset: number; limit: number } {
  const n = (raw: string | null, fallback: number) => {
    const parsed = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return { offset: n(offset, 0), limit: Math.min(Math.max(n(limit, HISTORY_PAGE), 1), HISTORY_PAGE_MAX) };
}

/** What a delete request is asking to remove, or null when it does not say. */
export function parseHistoryTarget(body: unknown): HistoryTarget | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  if (b.kind === "all") return { kind: "all" };
  if (b.kind === "movie") {
    const movieId = id(b.movieId);
    return movieId ? { kind: "movie", movieId } : null;
  }
  if (b.kind === "episode") {
    const showId = id(b.showId);
    const season = count(b.season);
    const episode = count(b.episode);
    return showId && season !== null && episode !== null ? { kind: "episode", showId, season, episode } : null;
  }
  return null;
}

/** A Jellyfin item, reduced to what identifies it as a history entry. */
export type WatchedItem = {
  type: "Movie" | "Episode";
  /** The movie's TMDB id, or for an episode its show's. */
  tmdbId: string | null;
  season: number | null;
  episode: number | null;
};

/** Whether a Jellyfin item is the thing a delete names. */
export function targetCovers(target: HistoryTarget, item: WatchedItem): boolean {
  if (target.kind === "all") return true;
  if (target.kind === "movie") return item.type === "Movie" && item.tmdbId === target.movieId;
  return (
    item.type === "Episode" &&
    item.tmdbId === target.showId &&
    item.season === target.season &&
    item.episode === target.episode
  );
}
