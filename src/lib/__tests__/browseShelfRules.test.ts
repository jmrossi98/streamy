import { describe, it, expect } from "vitest";
import {
  clampPages,
  dedupeById,
  hasMore,
  MAX_SHELF_PAGES,
  parseShelf,
  shelfHref,
  shelfSlug,
  WATCHLIST_SHELVES,
  watchlistShelfHref,
  type Shelf,
} from "../browseShelfRules";

describe("shelf addresses", () => {
  const shelves: Shelf[] = [
    { kind: "trending" },
    { kind: "downloaded" },
    { kind: "my-list" },
    { kind: "genre", genreId: 878 },
  ];

  it("round-trips every shelf through its URL segment", () => {
    for (const shelf of shelves) expect(parseShelf(shelfSlug(shelf))).toEqual(shelf);
  });

  it("builds the link a row heading uses", () => {
    expect(shelfHref("movies", { kind: "genre", genreId: 28 })).toBe("/movies/browse/genre-28");
    expect(shelfHref("tv", { kind: "trending" })).toBe("/tv/browse/trending");
  });

  it("refuses anything that is not a shelf", () => {
    for (const bad of ["", "genre-", "genre-abc", "genre-28/extra", "popular", "genre--1"]) {
      expect(parseShelf(bad)).toBeNull();
    }
  });
});

describe("paging", () => {
  it("clamps the page count to something sensible", () => {
    expect(clampPages(undefined)).toBe(1);
    expect(clampPages("0")).toBe(1);
    expect(clampPages("abc")).toBe(1);
    expect(clampPages("3")).toBe(3);
    expect(clampPages("999")).toBe(MAX_SHELF_PAGES);
  });

  it("offers more only while pages come back full and the cap is not reached", () => {
    expect(hasMore(40, 2, true)).toBe(true);
    expect(hasMore(33, 2, true)).toBe(false);
    expect(hasMore(200, MAX_SHELF_PAGES, true)).toBe(false);
    expect(hasMore(500, 1, false)).toBe(false);
  });

  it("drops a title TMDB repeated on a later page", () => {
    expect(dedupeById([{ id: 1 }, { id: "2" }, { id: "1" }, { id: 2 }, { id: 3 }])).toEqual([{ id: 1 }, { id: "2" }, { id: 3 }]);
  });
});

describe("My List shelves", () => {
  it("gives each saved kind its own page under /watchlist", () => {
    expect(WATCHLIST_SHELVES.map(watchlistShelfHref)).toEqual([
      "/watchlist/movies",
      "/watchlist/shows",
      "/watchlist/games",
      "/watchlist/flash",
    ]);
  });
});
