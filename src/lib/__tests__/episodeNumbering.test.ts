import { describe, it, expect } from "vitest";
import { seasonInOtherNumbering, toOtherNumbering, type EpisodeRef } from "../episodeNumbering";

const season = (s: number, n: number): EpisodeRef[] => Array.from({ length: n }, (_, i) => ({ season: s, episode: i + 1 }));

// Frieren, 2026-10-17: TMDB one season of 38, TVDB (Sonarr/Jellyfin) 28 + 10.
const FRIEREN_TMDB = { 1: 38 };
const FRIEREN_TVDB = [...season(0, 3), ...season(1, 28), ...season(2, 10)];

describe("toOtherNumbering", () => {
  it("finds TMDB's episode 29 as TVDB's season 2 episode 1", () => {
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 1, episode: 29 })).toEqual({ season: 2, episode: 1 });
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 1, episode: 38 })).toEqual({ season: 2, episode: 10 });
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 1, episode: 39 })).toBeNull();
  });
  it("leaves an episode both sides number the same alone", () => {
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 1, episode: 5 })).toEqual({ season: 1, episode: 5 });
    const tmdb = { 1: 10, 2: 10 };
    const other = [...season(1, 10), ...season(2, 12)]; // TVDB lists two more, unaired
    expect(toOtherNumbering(tmdb, other, { season: 2, episode: 3 })).toEqual({ season: 2, episode: 3 });
  });
  it("matches by position when an earlier season is split differently", () => {
    // TMDB 12 + 12, TVDB one season of 24.
    expect(toOtherNumbering({ 1: 12, 2: 12 }, season(1, 24), { season: 2, episode: 1 })).toEqual({ season: 1, episode: 13 });
  });
  it("never translates specials, nor anything without TMDB's layout", () => {
    expect(toOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, { season: 0, episode: 2 })).toEqual({ season: 0, episode: 2 });
    expect(toOtherNumbering(null, FRIEREN_TVDB, { season: 1, episode: 29 })).toBeNull();
  });
});

describe("seasonInOtherNumbering", () => {
  it("covers both TVDB seasons for Frieren's single TMDB season", () => {
    const got = seasonInOtherNumbering(FRIEREN_TMDB, FRIEREN_TVDB, 1);
    expect(got).toHaveLength(38);
    expect(got[28]).toEqual({ tmdbEpisode: 29, other: { season: 2, episode: 1 } });
  });
  it("is the other side's whole season when the layouts agree, extra episodes included", () => {
    const other = [...season(1, 10), ...season(2, 12)];
    const got = seasonInOtherNumbering({ 1: 10, 2: 10 }, other, 2);
    expect(got).toHaveLength(12);
    expect(got[11]).toEqual({ tmdbEpisode: 12, other: { season: 2, episode: 12 } });
    expect(seasonInOtherNumbering(null, other, 2)).toHaveLength(12);
  });
});
