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
  | { kind: "holiday" }
  /** Everything downloaded, A to Z. */
  | { kind: "all" }
  | { kind: "my-list" }
  | { kind: "genre"; genreId: number }
  /** The library cut other ways than genre; see libraryRowRules.ts. */
  | { kind: "recent" }
  | { kind: "top-rated" }
  | { kind: "hidden-gems" }
  /** Today's shuffle of the whole library. */
  | { kind: "picks" }
  /** Movies only: by runtime. */
  | { kind: "short" }
  | { kind: "long" }
  | { kind: "decade"; decade: number }
  | { kind: "collection"; slug: string };

export type ShelfMedia = "movies" | "tv";

const PLAIN_SHELVES = new Set<Shelf["kind"]>([
  "trending",
  "holiday",
  "all",
  "my-list",
  "recent",
  "top-rated",
  "hidden-gems",
  "picks",
  "short",
  "long",
]);

type PlainShelf = Exclude<Shelf, { kind: "genre" | "decade" | "collection" }>;

export function shelfSlug(shelf: Shelf): string {
  if (shelf.kind === "genre") return `genre-${shelf.genreId}`;
  if (shelf.kind === "decade") return `decade-${shelf.decade}`;
  if (shelf.kind === "collection") return `collection-${shelf.slug}`;
  return shelf.kind;
}

/** The shelf a URL segment names, or null for anything that is not one. */
export function parseShelf(slug: string): Shelf | null {
  if (PLAIN_SHELVES.has(slug as Shelf["kind"])) return { kind: slug as PlainShelf["kind"] };
  const genre = /^genre-(\d{1,6})$/.exec(slug);
  if (genre) return { kind: "genre", genreId: Number(genre[1]) };
  const decade = /^decade-(\d{4})$/.exec(slug);
  if (decade) return { kind: "decade", decade: Number(decade[1]) };
  // Any well-formed collection name parses; whether such a collection exists
  // is for the shelf to answer (libraryCollections.ts), the way a genre id is.
  const collection = /^collection-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(slug);
  return collection ? { kind: "collection", slug: collection[1] } : null;
}

export function shelfHref(media: ShelfMedia, shelf: Shelf): string {
  return `/${media}/browse/${shelfSlug(shelf)}`;
}

/** TMDB serves lists twenty at a time. */
export const SHELF_PAGE_SIZE = 20;

/**
 * How many tiles a sideways row renders when it has a shelf to open. My List
 * rendered all ~680 saved titles as tiles at once, and the page paid to build
 * and hydrate every one; nobody scrolls a row that far when the heading opens
 * the whole list as a grid.
 */
export const ROW_WINDOW = 40;

/** A row's tiles: the first ROW_WINDOW when a shelf holds the rest, else all. */
export function rowWindow<T>(items: T[], hasShelf: boolean): T[] {
  return hasShelf && items.length > ROW_WINDOW ? items.slice(0, ROW_WINDOW) : items;
}
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
 * own list, anything drawn from the downloaded library) pass `paged: false`.
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
export const WATCHLIST_SHELVES = ["movies", "shows", "anime", "games", "flash"] as const;
export type WatchlistShelf = (typeof WATCHLIST_SHELVES)[number];

export function watchlistShelfHref(kind: WatchlistShelf): string {
  return `/watchlist/${kind}`;
}
