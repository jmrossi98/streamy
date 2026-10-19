import { describe, it, expect } from "vitest";
import {
  hasEpisodeInfo,
  isUnaired,
  listableEpisodes,
  localToday,
  type ListedEpisode,
} from "../episodeListRules";

function ep(overrides: Partial<ListedEpisode> & { episodeNumber: number }): ListedEpisode {
  return {
    name: `Episode ${overrides.episodeNumber}`,
    overview: "",
    hasStill: false,
    airDate: null,
    ...overrides,
  };
}

describe("hasEpisodeInfo", () => {
  it("is false for TMDB's bare placeholder row", () => {
    expect(hasEpisodeInfo(ep({ episodeNumber: 4 }))).toBe(false);
    expect(hasEpisodeInfo(ep({ episodeNumber: 4, name: "episode 4" }))).toBe(false);
    expect(hasEpisodeInfo(ep({ episodeNumber: 4, name: "  " }))).toBe(false);
  });

  it("is true once there is a real title, a synopsis or a still", () => {
    expect(hasEpisodeInfo(ep({ episodeNumber: 3, name: "She Said, She Said" }))).toBe(true);
    expect(hasEpisodeInfo(ep({ episodeNumber: 4, overview: "Robyn pushes Ashley." }))).toBe(true);
    expect(hasEpisodeInfo(ep({ episodeNumber: 4, hasStill: true }))).toBe(true);
  });

  it("does not count an air date alone as information", () => {
    expect(hasEpisodeInfo(ep({ episodeNumber: 4, airDate: "2026-11-01" }))).toBe(false);
  });
});

describe("isUnaired", () => {
  const today = "2026-10-19";
  it("is true only for a date after today", () => {
    expect(isUnaired({ airDate: "2026-10-25" }, today)).toBe(true);
    expect(isUnaired({ airDate: "2026-10-19" }, today)).toBe(false);
    expect(isUnaired({ airDate: "2026-10-12" }, today)).toBe(false);
  });

  it("never calls an undated episode unaired", () => {
    expect(isUnaired({ airDate: null }, today)).toBe(false);
  });
});

describe("listableEpisodes", () => {
  const season = [
    ep({ episodeNumber: 1, name: "Read Between The Lies", overview: "Karen navigates life." }),
    ep({ episodeNumber: 2, name: "Sofia Home!", hasStill: true }),
    ep({ episodeNumber: 3, name: "She Said, She Said", airDate: "2026-10-25" }),
    ep({ episodeNumber: 4 }),
    ep({ episodeNumber: 5 }),
  ];

  it("drops placeholders and keeps everything described", () => {
    expect(listableEpisodes(season, []).map((e) => e.episodeNumber)).toEqual([1, 2, 3]);
  });

  it("keeps a placeholder Sonarr already tracks", () => {
    expect(listableEpisodes(season, [5]).map((e) => e.episodeNumber)).toEqual([1, 2, 3, 5]);
  });

  it("keeps the season's order", () => {
    expect(listableEpisodes([...season].reverse(), [4]).map((e) => e.episodeNumber)).toEqual([4, 3, 2, 1]);
  });
});

describe("localToday", () => {
  it("formats the local calendar date, zero-padded", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
    expect(localToday(new Date(2026, 9, 19, 0, 1))).toBe("2026-10-19");
  });
});
