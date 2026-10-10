import { describe, it, expect } from "vitest";
import { filterShelf, isFiltering, shelfGenres, NO_SHELF_FILTER, type ShelfTitle } from "../shelfFilterRules";

const t = (title: string, year: string, rating: number, genres: string[]): ShelfTitle => ({ title, year, rating, genres });
const shelf = [
  t("The Matrix", "1999", 8.2, ["Action", "Science Fiction"]),
  t("Amélie", "2001", 7.9, ["Comedy", "Romance"]),
  t("Back to the Future", "1985", 8.3, ["Adventure", "Comedy", "Science Fiction"]),
  t("A Quiet Place", "2018", 7.4, ["Horror"]),
  t("Unreleased", "", 0, ["Horror"]),
];
const same = (x: ShelfTitle) => x;
const titles = (filter: Partial<typeof NO_SHELF_FILTER>) =>
  filterShelf(shelf, same, { ...NO_SHELF_FILTER, ...filter }).map((x) => x.title);

describe("the shelf filter bar", () => {
  it("leaves the shelf alone when nothing is set", () => {
    expect(isFiltering(NO_SHELF_FILTER)).toBe(false);
    expect(filterShelf(shelf, same, NO_SHELF_FILTER)).toEqual(shelf);
    expect(isFiltering({ ...NO_SHELF_FILTER, query: "  " })).toBe(false);
    expect(isFiltering({ ...NO_SHELF_FILTER, sort: "title" })).toBe(true);
  });

  it("finds by name, ignoring case, accents and word order", () => {
    expect(titles({ query: "amelie" })).toEqual(["Amélie"]);
    expect(titles({ query: "FUTURE back" })).toEqual(["Back to the Future"]);
    expect(titles({ query: "zzz" })).toEqual([]);
  });

  it("keeps one genre, and combines it with the name", () => {
    expect(titles({ genre: "Science Fiction" })).toEqual(["The Matrix", "Back to the Future"]);
    expect(titles({ genre: "Comedy", query: "back" })).toEqual(["Back to the Future"]);
  });

  it("offers only the genres on the shelf, alphabetically", () => {
    expect(shelfGenres(shelf, same)).toEqual(["Action", "Adventure", "Comedy", "Horror", "Romance", "Science Fiction"]);
  });

  it("sorts by title without the leading article", () => {
    expect(titles({ sort: "title" })).toEqual(["Amélie", "Back to the Future", "The Matrix", "A Quiet Place", "Unreleased"]);
  });

  it("sorts by year both ways, with undated titles last", () => {
    expect(titles({ sort: "newest" })).toEqual(["A Quiet Place", "Amélie", "The Matrix", "Back to the Future", "Unreleased"]);
    expect(titles({ sort: "oldest" })).toEqual(["Back to the Future", "The Matrix", "Amélie", "A Quiet Place", "Unreleased"]);
  });

  it("orders titles from the same year by their full date", () => {
    const year = [
      { ...t("Late", "1999", 5, []), released: "1999-11-05" },
      { ...t("Undated", "1999", 5, []) },
      { ...t("Early", "1999", 5, []), released: "1999-03-31" },
    ];
    const order = (sort: "newest" | "oldest") => filterShelf(year, same, { ...NO_SHELF_FILTER, sort }).map((x) => x.title);
    expect(order("oldest")).toEqual(["Undated", "Early", "Late"]);
    expect(order("newest")).toEqual(["Late", "Early", "Undated"]);
  });

  it("sorts by rating, highest first", () => {
    expect(titles({ sort: "rating" }).slice(0, 2)).toEqual(["Back to the Future", "The Matrix"]);
  });

  it("does not reorder the shelf it was given", () => {
    const before = shelf.map((x) => x.title);
    titles({ sort: "title" });
    expect(shelf.map((x) => x.title)).toEqual(before);
  });
});
