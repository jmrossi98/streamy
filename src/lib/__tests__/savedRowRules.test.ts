import { describe, expect, it } from "vitest";
import { newestSaved } from "../savedRowRules";

describe("one My List row across kinds", () => {
  const movies = [
    { movieId: "m-old", addedAt: new Date("2026-10-01") },
    { movieId: "m-new", addedAt: new Date("2026-10-18") },
  ];
  const shows = [
    { showId: "s-mid", addedAt: new Date("2026-10-10") },
    { showId: "s-newest", addedAt: new Date("2026-10-19") },
  ];

  it("puts the newest save first whatever its kind", () => {
    expect(newestSaved(movies, shows, 10).map((r) => r.id)).toEqual(["s-newest", "m-new", "s-mid", "m-old"]);
  });

  it("keeps to the limit and accepts epoch numbers", () => {
    const refs = newestSaved([{ movieId: "a", addedAt: 5 }], [{ showId: "b", addedAt: 7 }], 1);
    expect(refs).toEqual([{ kind: "show", id: "b", addedAt: 7 }]);
    expect(newestSaved(movies, shows, 0)).toEqual([]);
  });

  it("orders a tie movie first so renders agree", () => {
    const refs = newestSaved([{ movieId: "m", addedAt: 1 }], [{ showId: "s", addedAt: 1 }], 5);
    expect(refs.map((r) => r.kind)).toEqual(["movie", "show"]);
  });
});
