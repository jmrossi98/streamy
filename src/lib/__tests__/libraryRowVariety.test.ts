import { describe, it, expect } from "vitest";
import {
  collectionBuckets,
  dailyPicks,
  decadeBuckets,
  decadeLabel,
  decadeOf,
  hiddenGems,
  interleave,
  longWatches,
  recentlyAdded,
  runtimeMinutes,
  shortWatches,
  spreadRows,
  todaySeed,
  topRated,
} from "../libraryRowRules";
import { COLLECTIONS, collectionBySlug } from "../libraryCollections";

const ids = (titles: { id: string | number }[]) => titles.map((t) => String(t.id));

describe("spreading titles across rows", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  const d = { id: "d" };

  it("leads every later row with titles the rows above did not show", () => {
    const rows = spreadRows([{ titles: [a, b, c] }, { titles: [a, b, d] }, { titles: [d, a, c] }], 2);
    expect(rows.map(ids)).toEqual([["a", "b"], ["d", "a"], ["c", "d"]]);
  });

  it("never drops a title from a row shorter than the limit", () => {
    const rows = spreadRows([{ titles: [a, b] }, { titles: [a, b] }], 20);
    expect(rows.map(ids)).toEqual([["a", "b"], ["a", "b"]]);
  });

  it("keeps every row full while it has anything unseen to offer", () => {
    const rows = spreadRows([{ titles: [a, b, c] }, { titles: [a, b, c, d] }], 3);
    expect(ids(rows[1])).toEqual(["d", "a", "b"]);
  });

  it("leaves the first row as it came", () => {
    expect(ids(spreadRows([{ titles: [c, a, b] }], 2)[0])).toEqual(["c", "a"]);
  });

  it("drops a row that adds too little, and lets the next row have those titles", () => {
    const e = { id: "e" };
    const rows = spreadRows([
      { titles: [a, b, c] },
      { titles: [a, b, c, d], minFresh: 2 },
      { titles: [a, d, e], minFresh: 2 },
    ]);
    expect(rows.map(ids)).toEqual([["a", "b", "c"], [], ["d", "e", "a"]]);
  });

  it("keeps a short row when all of it is new", () => {
    const rows = spreadRows([{ titles: [a, b, c] }, { titles: [d], minFresh: 4 }]);
    expect(rows.map(ids)).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("treats titles already on the page as shown, so a row leads with others", () => {
    const rows = spreadRows([{ titles: [a, b, c] }], 2, ["a"]);
    expect(rows.map(ids)).toEqual([["b", "c"]]);
  });

  it("shows a row with no threshold whatever it adds, and an empty row as empty", () => {
    const rows = spreadRows([{ titles: [a, b] }, { titles: [a, b] }, { titles: [a, b], minFresh: 2 }, { titles: [] }]);
    expect(rows.map(ids)).toEqual([["a", "b"], ["a", "b"], [], []]);
  });
});

describe("recently added", () => {
  it("puts the newest arrival first and undated titles last, in their own order", () => {
    const rows = recentlyAdded([
      { id: 1, addedAt: "2026-10-01T00:00:00Z" },
      { id: 2, addedAt: null },
      { id: 3, addedAt: "2026-10-17T00:00:00Z" },
      { id: 4 },
    ]);
    expect(ids(rows)).toEqual(["3", "1", "2", "4"]);
  });
});

describe("ratings", () => {
  const library = [
    { id: "hit", rating: 8.5, popularity: 100 },
    { id: "famous-dud", rating: 5, popularity: 90 },
    { id: "sleeper", rating: 8.5, popularity: 5 },
    { id: "fine", rating: 7, popularity: 20 },
    { id: "meh", rating: 6.9, popularity: 1 },
  ];

  it("top rated keeps the well rated, best first, the better known among equals", () => {
    expect(ids(topRated(library))).toEqual(["hit", "sleeper", "fine"]);
  });

  it("hidden gems leaves out the most popular quarter and leads with the least known", () => {
    const gems = hiddenGems(library);
    expect(ids(gems)).not.toContain("hit");
    expect(ids(gems)).not.toContain("famous-dud");
    expect(ids(gems)).toEqual(["sleeper", "fine"]);
  });
});

describe("decades", () => {
  it("reads a decade from a year and labels it the way people say it", () => {
    expect(decadeOf("1994")).toBe(1990);
    expect(decadeOf("2007")).toBe(2000);
    expect(decadeOf("")).toBeNull();
    expect(decadeOf(undefined)).toBeNull();
    expect(decadeLabel(1990)).toBe("'90s");
    expect(decadeLabel(1970)).toBe("'70s");
    expect(decadeLabel(2000)).toBe("2000s");
    expect(decadeLabel(2020)).toBe("2020s");
  });

  it("buckets by decade, fullest first, only where there is enough", () => {
    const titles = [
      ...Array.from({ length: 3 }, (_, i) => ({ id: `90-${i}`, year: `199${i}` })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `00-${i}`, year: `200${i}` })),
      { id: "none", year: "" },
    ];
    const buckets = decadeBuckets(titles, 2);
    expect(buckets.map((b) => b.decade)).toEqual([1990, 2000]);
    expect(ids(buckets[0].titles)).toEqual(["90-0", "90-1", "90-2"]);
    expect(decadeBuckets(titles, 3).map((b) => b.decade)).toEqual([1990]);
  });
});

describe("collections", () => {
  it("shelves a title under a collection by any of its keywords, case aside", () => {
    const heists = collectionBySlug("heists")!;
    const titles = [
      { id: "ocean", keywords: ["Heist", "las vegas"] },
      { id: "heat", keywords: ["bank robbery"] },
      { id: "drama", keywords: ["grief"] },
    ];
    const buckets = collectionBuckets(titles, [heists], 1);
    expect(buckets).toHaveLength(1);
    expect(ids(buckets[0].titles)).toEqual(["ocean", "heat"]);
  });

  it("makes no row for a collection with too little in it, and keeps the curated order", () => {
    const titles = Array.from({ length: 6 }, (_, i) => ({ id: i, keywords: ["zombie"] })).concat([
      { id: 99, keywords: ["heist"] },
    ]);
    const buckets = collectionBuckets(titles, COLLECTIONS);
    expect(buckets.map((b) => b.collection.slug)).toEqual(["zombies"]);
  });

  it("has unique slugs that parse as shelf segments", () => {
    const slugs = COLLECTIONS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe("runtime", () => {
  it("reads minutes from the duration a card shows", () => {
    expect(runtimeMinutes("1h 52m")).toBe(112);
    expect(runtimeMinutes("2h 0m")).toBe(120);
    expect(runtimeMinutes("45m")).toBe(45);
    expect(runtimeMinutes("")).toBeNull();
    expect(runtimeMinutes(undefined)).toBeNull();
  });

  it("splits short watches from epics and ignores unknown runtimes", () => {
    const titles = [
      { id: "short", duration: "1h 30m" },
      { id: "mid", duration: "2h 10m" },
      { id: "epic", duration: "3h 1m" },
      { id: "unknown", duration: "" },
    ];
    expect(ids(shortWatches(titles))).toEqual(["short"]);
    expect(ids(longWatches(titles))).toEqual(["epic"]);
  });
});

describe("daily picks", () => {
  const titles = Array.from({ length: 30 }, (_, i) => ({ id: i }));

  it("gives one order per seed, every title once, without touching the input", () => {
    const before = ids(titles);
    const a = dailyPicks(titles, "2026-10-18");
    expect(ids(dailyPicks(titles, "2026-10-18"))).toEqual(ids(a));
    expect([...ids(a)].sort()).toEqual([...before].sort());
    expect(ids(titles)).toEqual(before);
  });

  it("changes with the day", () => {
    expect(ids(dailyPicks(titles, "2026-10-18"))).not.toEqual(ids(dailyPicks(titles, "2026-10-19")));
  });

  it("seeds on the date alone", () => {
    expect(todaySeed(new Date("2026-10-18T23:59:00Z"))).toBe("2026-10-18");
    expect(todaySeed(new Date("2026-10-18T00:01:00Z"))).toBe("2026-10-18");
  });
});

describe("interleaving", () => {
  it("deals an extra row in after every two main rows, then the rest", () => {
    expect(interleave(["g1", "g2", "g3", "g4", "g5"], ["x1", "x2", "x3"])).toEqual([
      "g1",
      "g2",
      "x1",
      "g3",
      "g4",
      "x2",
      "g5",
      "x3",
    ]);
    expect(interleave([], ["x1"])).toEqual(["x1"]);
    expect(interleave(["g1"], [])).toEqual(["g1"]);
  });
});
