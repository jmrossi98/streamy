import { describe, it, expect } from "vitest";
import { byPopularity, genreBuckets, inGenre } from "../libraryRowRules";

const GENRES = [
  { id: 28, name: "Action" },
  { id: 35, name: "Comedy" },
  { id: 18, name: "Drama" },
  { id: 27, name: "Horror" },
  { id: 37, name: "Western" },
  { id: 10770, name: "TV Movie" },
];

const LIBRARY = [
  { id: "true-grit", genres: ["Western", "Drama"], popularity: 30 },
  { id: "shaun", genres: ["Horror", "Comedy"], popularity: 50 },
  { id: "tombstone", genres: ["Western", "Action"], popularity: 40 },
  { id: "halloweentown", genres: ["Comedy", "TV Movie"], popularity: 10 },
  { id: "little-women", genres: ["Drama"], popularity: 20 },
];

const ids = (titles: { id: string }[]) => titles.map((t) => t.id);

describe("genre buckets", () => {
  it("shelves a title under every genre it carries", () => {
    const buckets = genreBuckets(LIBRARY, GENRES);
    const names = (id: string) => buckets.filter((b) => ids(b.titles).includes(id)).map((b) => b.genre.name).sort();
    expect(names("shaun")).toEqual(["Comedy", "Horror"]);
    expect(names("true-grit")).toEqual(["Drama", "Western"]);
  });

  it("never shelves a title under a genre it does not carry", () => {
    for (const bucket of genreBuckets(LIBRARY, GENRES)) {
      for (const title of bucket.titles) expect(title.genres).toContain(bucket.genre.name);
    }
  });

  it("makes no row for a genre with nothing downloaded, or for TV Movie", () => {
    const names = genreBuckets(LIBRARY.filter((t) => t.id !== "tombstone"), GENRES).map((b) => b.genre.name);
    expect(names).not.toContain("Action");
    expect(names).not.toContain("TV Movie");
  });

  it("puts the lead genres first in the order named, then the fullest", () => {
    expect(genreBuckets(LIBRARY, GENRES, [37, 27]).map((b) => b.genre.name)).toEqual([
      "Western",
      "Horror",
      "Comedy",
      "Drama",
      "Action",
    ]);
  });

  it("keeps the order the titles came in", () => {
    const western = genreBuckets(byPopularity(LIBRARY), GENRES).find((b) => b.genre.name === "Western");
    expect(ids(western!.titles)).toEqual(["tombstone", "true-grit"]);
  });
});

describe("helpers", () => {
  it("sorts most popular first without touching the input", () => {
    const before = ids(LIBRARY);
    expect(ids(byPopularity(LIBRARY))).toEqual(["shaun", "tombstone", "true-grit", "little-women", "halloweentown"]);
    expect(ids(LIBRARY)).toEqual(before);
  });

  it("filters to one genre by exact name", () => {
    expect(ids(inGenre(LIBRARY, "Drama"))).toEqual(["true-grit", "little-women"]);
    expect(inGenre(LIBRARY, "Dram")).toEqual([]);
  });
});

describe("the whole library, A to Z", () => {
  it("files a title under its name without the article, and leaves the input alone", async () => {
    const { alphabetical } = await import("../libraryRowRules");
    const titles = [{ t: "The Matrix" }, { t: "Amélie" }, { t: "A Quiet Place" }, { t: "Zodiac" }];
    expect(alphabetical(titles, (x) => x.t).map((x) => x.t)).toEqual(["Amélie", "The Matrix", "A Quiet Place", "Zodiac"]);
    expect(titles[0].t).toBe("The Matrix");
  });
});
