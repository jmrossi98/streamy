/**
 * The full-list page behind a browse row. Pure.
 *
 * A row on Movies or TV Shows is a window: eight or ten titles of a genre
 * that holds thousands, scrolled sideways one card at a time. Its heading
 * links to the whole shelf as a grid, the way a ROM platform or a Flash genre
 * already does. This names those shelves and builds their addresses, so the
 * row that links and the page that answers cannot disagree.
 */

export type Shelf =
  | { kind: "trending" }
  | { kind: "downloaded" }
  | { kind: "my-list" }
  | { kind: "genre"; genreId: number };

export type ShelfMedia = "movies" | "tv";

export function shelfSlug(shelf: Shelf): string {
  return shelf.kind === "genre" ? `genre-${shelf.genreId}` : shelf.kind;
}

/** The shelf a URL segment names, or null for anything that is not one. */
export function parseShelf(slug: string): Shelf | null {
  if (slug === "trending" || slug === "downloaded" || slug === "my-list") return { kind: slug };
  const genre = /^genre-(\d{1,6})$/.exec(slug);
  return genre ? { kind: "genre", genreId: Number(genre[1]) } : null;
}

export function shelfHref(media: ShelfMedia, shelf: Shelf): string {
  return `/${media}/browse/${shelfSlug(shelf)}`;
}

/** TMDB serves lists twenty at a time. */
export const SHELF_PAGE_SIZE = 20;
/** As far as "Load more" goes: 200 titles, by which point search is the better tool. */
export const MAX_SHELF_PAGES = 10;

/** How many pages a `?pages=` value asks for: at least one, at most the cap. */
export function clampPages(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_SHELF_PAGES);
}

/**
 * Whether there is likely more to load: every page asked for came back full,
 * and the cap has not been reached. Shelves that are not paged (the viewer's
 * own list, the downloaded library) pass `paged: false`.
 */
export function hasMore(shown: number, pages: number, paged: boolean): boolean {
  return paged && pages < MAX_SHELF_PAGES && shown >= pages * SHELF_PAGE_SIZE;
}

/** One entry per id, first occurrence kept: TMDB repeats titles across pages as popularity shifts. */
export function dedupeById<T extends { id: string | number }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The kinds of saved title that have a full-grid page under My List. */
export const WATCHLIST_SHELVES = ["movies", "shows", "games", "flash"] as const;
export type WatchlistShelf = (typeof WATCHLIST_SHELVES)[number];

export function watchlistShelfHref(kind: WatchlistShelf): string {
  return `/watchlist/${kind}`;
}
