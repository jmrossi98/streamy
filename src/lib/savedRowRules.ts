/**
 * The order of a single My List row that mixes movies and shows. Pure.
 *
 * Home used to show two rows, "My List - Movies" and "My List - Shows". One
 * strip, newest save on the left whatever its kind, is how the viewer thinks
 * of their list ("the thing I saved last night"), the way Continue Watching
 * already mixes kinds by when they were last watched. The Movies and TV tabs
 * keep their own single-kind rows.
 */

export type SavedRef = { kind: "movie" | "show"; id: string; addedAt: number };

/**
 * The newest `limit` saves across both kinds, newest first. Ties keep movies
 * before shows, so the order is stable between renders.
 */
export function newestSaved(
  movies: { movieId: string; addedAt: Date | number }[],
  shows: { showId: string; addedAt: Date | number }[],
  limit: number
): SavedRef[] {
  const at = (d: Date | number) => (typeof d === "number" ? d : d.getTime());
  const all: SavedRef[] = [
    ...movies.map((m) => ({ kind: "movie" as const, id: m.movieId, addedAt: at(m.addedAt) })),
    ...shows.map((s) => ({ kind: "show" as const, id: s.showId, addedAt: at(s.addedAt) })),
  ];
  return all
    .sort((a, b) => b.addedAt - a.addedAt || (a.kind === b.kind ? 0 : a.kind === "movie" ? -1 : 1))
    .slice(0, Math.max(0, limit));
}
