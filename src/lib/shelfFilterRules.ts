/**
 * Narrowing and ordering a shelf's grid. Pure.
 *
 * A shelf arrives whole and in its own order (most popular first), so the bar
 * above the grid only ever works on what is already on the page: a name to
 * look for, one genre to keep, and an order to put the rest in.
 */

/** What the bar needs to know about a title, whether it is a movie or a show. */
export type ShelfTitle = {
  title: string;
  /** Release year as TMDB gives it: "1999", or "" when unknown. */
  year: string;
  /** Full date, "1999-03-31", when known: orders titles within the same year. */
  released?: string;
  rating: number;
  genres: string[];
};

export const SHELF_SORTS = [
  { value: "shelf", label: "Most popular" },
  { value: "title", label: "Title A–Z" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "rating", label: "Highest rated" },
] as const;

export type ShelfSort = (typeof SHELF_SORTS)[number]["value"];

export type ShelfFilter = { query: string; genre: string; sort: ShelfSort };

export const NO_SHELF_FILTER: ShelfFilter = { query: "", genre: "", sort: "shelf" };

export function isFiltering(filter: ShelfFilter): boolean {
  return filter.query.trim() !== "" || filter.genre !== "" || filter.sort !== "shelf";
}

/** Lower case, accents and punctuation dropped: "Amélie" is found by "amelie", "WALL·E" by "wall e". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A leading article is not what anyone files a title under. */
export function sortKey(title: string): string {
  return fold(title).replace(/^(the|a|an) /, "");
}

/** The genres present on this shelf, alphabetical: only ones that would match something. */
export function shelfGenres<T>(items: T[], describe: (item: T) => ShelfTitle): string[] {
  return [...new Set(items.flatMap((item) => describe(item).genres))].sort((a, b) => a.localeCompare(b));
}

export function filterShelf<T>(items: T[], describe: (item: T) => ShelfTitle, filter: ShelfFilter): T[] {
  // Every word must appear, in any order, so "back future" finds the film.
  const words = fold(filter.query).split(" ").filter(Boolean);
  const kept = items.filter((item) => {
    const d = describe(item);
    if (filter.genre && !d.genres.includes(filter.genre)) return false;
    const name = fold(d.title);
    return words.every((w) => name.includes(w));
  });
  if (filter.sort === "shelf") return kept;

  // ISO dates order as text. A bare year stands in as that January 1st.
  const date = (item: T) => {
    const d = describe(item);
    return d.released || (d.year ? `${d.year}-01-01` : "");
  };
  // A title with no date sorts last either way, rather than passing as the oldest.
  const byYear = (direction: 1 | -1) => (a: T, b: T) => {
    const [da, db] = [date(a), date(b)];
    if (!da || !db) return Number(!da) - Number(!db);
    return da.localeCompare(db) * direction;
  };
  const compare: Record<Exclude<ShelfSort, "shelf">, (a: T, b: T) => number> = {
    title: (a, b) => sortKey(describe(a).title).localeCompare(sortKey(describe(b).title)),
    newest: byYear(-1),
    oldest: byYear(1),
    rating: (a, b) => describe(b).rating - describe(a).rating,
  };
  // Array.prototype.sort is stable, so ties keep the shelf's own order.
  return [...kept].sort(compare[filter.sort]);
}
