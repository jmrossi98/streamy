/**
 * Turning the downloaded library into browse rows. Pure.
 *
 * The rows used to be TMDB's idea of a genre: the eight most popular films
 * tagged Action, almost none of which were on disk. Now a row is the part of
 * the library that carries the genre, so every card in it plays.
 */

export type RowGenre = { id: number; name: string };

/**
 * TMDB genres that are not a way anyone browses. "TV Movie" describes how a
 * film was released, not what it is.
 */
const NOT_A_SHELF = new Set(["TV Movie"]);

/** Most popular first. Stable for titles with no score. */
export function byPopularity<T extends { popularity?: number }>(titles: T[]): T[] {
  return [...titles].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
}

/** The titles carrying a genre, in the order given. */
export function inGenre<T extends { genres: string[] }>(titles: T[], genreName: string): T[] {
  return titles.filter((t) => t.genres.includes(genreName));
}

/**
 * One bucket per genre that has anything in it.
 *
 * A title sits in every genre TMDB gives it, not just the first: a horror
 * comedy is looked for under both, and picking one would hide it from half
 * the people looking. Genres with nothing downloaded produce no bucket, so
 * there are no empty rows to hide later.
 *
 * `lead` genres come first in the order named; the rest follow, fullest
 * first, so the rows nearest the top are the ones with the most to offer.
 */
export function genreBuckets<T extends { genres: string[] }>(
  titles: T[],
  genres: RowGenre[],
  lead: number[] = []
): { genre: RowGenre; titles: T[] }[] {
  const buckets = genres
    .filter((genre) => !NOT_A_SHELF.has(genre.name))
    .map((genre) => ({ genre, titles: inGenre(titles, genre.name) }))
    .filter((bucket) => bucket.titles.length > 0);

  const rank = (id: number) => {
    const at = lead.indexOf(id);
    return at === -1 ? lead.length : at;
  };
  return buckets.sort(
    (a, b) =>
      rank(a.genre.id) - rank(b.genre.id) ||
      b.titles.length - a.titles.length ||
      a.genre.name.localeCompare(b.genre.name)
  );
}
