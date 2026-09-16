import { describe, it, expect } from "vitest";
import {
  allTimePopular,
  catalogSize,
  getCategory,
  listCategories,
  searchCatalog,
  shelfFor,
} from "../flashCatalog";

/**
 * Asserted as invariants rather than against specific titles: the catalogue is
 * regenerated from Andkon by scripts/build-flash-catalog.mjs, so any test
 * naming a particular game would start failing the first time Andkon added or
 * removed one, for no real reason.
 */
describe("flash catalogue", () => {
  it("has categories, each with games", () => {
    const categories = listCategories();
    expect(categories.length).toBeGreaterThan(0);
    for (const c of categories) {
      expect(c.key).toMatch(/^[a-z]+$/);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.games.length).toBeGreaterThan(0);
    }
    expect(catalogSize()).toBe(
      categories.reduce((n, c) => n + c.games.length, 0)
    );
  });

  // Every game needs somewhere to be downloaded from. A Flashpoint id is
  // optional -- about half the catalogue has none -- but the Andkon path is
  // what makes those reachable at all, so it is never optional.
  it("gives every game an Andkon path", () => {
    for (const c of listCategories()) {
      for (const g of c.games) {
        expect(g.andkonPath).toMatch(/^[a-z0-9]+\/[a-z0-9._-]+$/);
      }
    }
  });

  it("has no duplicate games within a category", () => {
    for (const c of listCategories()) {
      const paths = c.games.map((g) => g.andkonPath);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it("returns null for an unknown category", () => {
    expect(getCategory("not-a-category")).toBeNull();
  });

  it("caps a shelf at the requested size", () => {
    const key = listCategories()[0].key;
    expect(shelfFor(key, 5).length).toBeLessThanOrEqual(5);
    expect(shelfFor("not-a-category", 5)).toEqual([]);
  });

  // Andkon's picks are its own hand-arranged order, and the shelves are stored
  // in it. Sorting picks alphabetically instead -- the first version of this --
  // opened every row with whatever began with a digit.
  it("puts picks at the front of a shelf", () => {
    for (const c of listCategories()) {
      const firstNonPick = c.games.findIndex((g) => !g.pick);
      if (firstNonPick === -1) continue;
      expect(c.games.slice(firstNonPick).some((g) => g.pick)).toBe(false);
    }
  });

  // All-Time Popular comes from Andkon's "once featured" history, oldest
  // first, rather than from the per-category picks -- those are a current
  // rotation, and building the row from them opened it with "100% Complete"
  // and "A Dralien Day".
  it("builds All-Time Popular from the featured history, in rank order", () => {
    const top = allTimePopular(20);
    expect(top.length).toBeGreaterThan(1);
    expect(new Set(top.map((g) => g.andkonPath)).size).toBe(top.length);

    const ranks = top.map((g) => g.allTimeRank);
    expect(ranks.every((r) => r !== null)).toBe(true);
    expect([...ranks].sort((a, b) => a! - b!)).toEqual(ranks);
  });

  it("caps All-Time Popular at the requested size", () => {
    expect(allTimePopular(5)).toHaveLength(5);
  });
});

describe("searchCatalog", () => {
  it("returns nothing for an empty query", () => {
    expect(searchCatalog("")).toEqual([]);
    expect(searchCatalog("   ")).toEqual([]);
  });

  it("only returns titles containing the query, case-insensitively", () => {
    for (const q of ["the", "ball", "2"]) {
      const hits = searchCatalog(q, 25);
      for (const h of hits) {
        expect(h.title.toLowerCase()).toContain(q.toLowerCase());
      }
    }
  });

  it("respects the limit", () => {
    expect(searchCatalog("a", 7).length).toBeLessThanOrEqual(7);
  });

  // An exact title match is what someone typing a full name wants first, ahead
  // of the longer titles that merely contain it.
  it("ranks an exact title match first", () => {
    const sample = listCategories()[0].games[0];
    const hits = searchCatalog(sample.title, 10);
    expect(hits[0].title.toLowerCase()).toBe(sample.title.toLowerCase());
  });

  it("finds nothing for a query no title contains", () => {
    expect(searchCatalog("zzzzznotarealgamezzzzz")).toEqual([]);
  });
});
