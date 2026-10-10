import { describe, it, expect } from "vitest";
import { historyPage, historyPaging, parseHistoryTarget, targetCovers, HISTORY_PAGE, HISTORY_PAGE_MAX, type HistoryRow } from "../watchHistoryRules";

const at = (day: number) => new Date(Date.UTC(2026, 9, day, 12));
const movie = (movieId: string, day: number): HistoryRow => ({ kind: "movie", movieId, seconds: 60, at: at(day) });
const ep = (showId: string, episode: number, day: number): HistoryRow => ({ kind: "episode", showId, season: 1, episode, seconds: 60, at: at(day) });

describe("reading the two progress tables as one history", () => {
  const movies = [movie("a", 9), movie("b", 5)];
  const episodes = [ep("s", 2, 8), ep("s", 1, 7)];

  it("interleaves them newest first", () => {
    const { rows } = historyPage(movies, episodes, 0, 10);
    expect(rows.map((r) => r.at.getUTCDate())).toEqual([9, 8, 7, 5]);
  });

  it("pages, and says whether there is more", () => {
    expect(historyPage(movies, episodes, 0, 3).hasMore).toBe(true);
    const last = historyPage(movies, episodes, 3, 3);
    expect(last.rows).toHaveLength(1);
    expect(last.hasMore).toBe(false);
  });
});

describe("paging values", () => {
  it("defaults, and clamps what it is given", () => {
    expect(historyPaging(null, null)).toEqual({ offset: 0, limit: HISTORY_PAGE });
    expect(historyPaging("60", "5000")).toEqual({ offset: 60, limit: HISTORY_PAGE_MAX });
    expect(historyPaging("-4", "0")).toEqual({ offset: 0, limit: 1 });
    expect(historyPaging("abc", "x")).toEqual({ offset: 0, limit: HISTORY_PAGE });
  });
});

describe("what a delete names", () => {
  it("reads each kind", () => {
    expect(parseHistoryTarget({ kind: "all" })).toEqual({ kind: "all" });
    expect(parseHistoryTarget({ kind: "movie", movieId: " 603 " })).toEqual({ kind: "movie", movieId: "603" });
    expect(parseHistoryTarget({ kind: "episode", showId: "1396", season: 0, episode: 3 })).toEqual({
      kind: "episode",
      showId: "1396",
      season: 0,
      episode: 3,
    });
  });

  it("refuses anything incomplete rather than guessing", () => {
    expect(parseHistoryTarget(null)).toBeNull();
    expect(parseHistoryTarget({})).toBeNull();
    expect(parseHistoryTarget({ kind: "movie" })).toBeNull();
    expect(parseHistoryTarget({ kind: "episode", showId: "1396", season: 1 })).toBeNull();
    expect(parseHistoryTarget({ kind: "episode", showId: "1396", season: "1", episode: 2 })).toBeNull();
    // A missing kind must never fall through to "everything".
    expect(parseHistoryTarget({ movieId: "603" })).toBeNull();
  });
});

describe("matching a delete to Jellyfin's items", () => {
  const film = { type: "Movie" as const, tmdbId: "603", season: null, episode: null };
  const episode = { type: "Episode" as const, tmdbId: "1396", season: 1, episode: 2 };

  it("matches only the named title", () => {
    expect(targetCovers({ kind: "movie", movieId: "603" }, film)).toBe(true);
    expect(targetCovers({ kind: "movie", movieId: "1396" }, episode)).toBe(false);
    expect(targetCovers({ kind: "episode", showId: "1396", season: 1, episode: 2 }, episode)).toBe(true);
    expect(targetCovers({ kind: "episode", showId: "1396", season: 1, episode: 3 }, episode)).toBe(false);
    expect(targetCovers({ kind: "episode", showId: "603", season: 1, episode: 2 }, film)).toBe(false);
  });

  it("matches everything for a full clear", () => {
    expect(targetCovers({ kind: "all" }, film)).toBe(true);
    expect(targetCovers({ kind: "all" }, episode)).toBe(true);
  });
});
