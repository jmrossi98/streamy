import { describe, it, expect } from "vitest";
import {
  followPlan,
  followSeriesUpdate,
  isFollowing,
  isUpcoming,
  latestSeason,
  wantedMonitoring,
  type FollowEpisode,
} from "../newEpisodeRules";

const NOW = Date.parse("2026-11-02T21:00:00Z");
const aired = "2026-10-26T00:00:00Z";
const coming = "2026-11-09T01:00:00Z";

const ep = (id: number, over: Partial<FollowEpisode> = {}): FollowEpisode => ({
  id,
  seasonNumber: 11,
  hasFile: false,
  monitored: false,
  airDateUtc: aired,
  ...over,
});

describe("latestSeason", () => {
  it("is the highest real season, never specials", () => {
    expect(latestSeason([{ seasonNumber: 0, monitored: false }, { seasonNumber: 3, monitored: false }, { seasonNumber: 11, monitored: true }])).toBe(11);
    expect(latestSeason([{ seasonNumber: 0, monitored: false }])).toBeNull();
    expect(latestSeason([])).toBeNull();
  });
});

describe("isFollowing", () => {
  const seasons = (latestMonitored: boolean) => [
    { seasonNumber: 0, monitored: false },
    { seasonNumber: 10, monitored: true },
    { seasonNumber: 11, monitored: latestMonitored },
  ];

  it("is the newest season's flag on a monitored series", () => {
    expect(isFollowing({ monitored: true, seasons: seasons(true) })).toBe(true);
    // Potomac on 2026-11-02: S11 episodes requested one by one, S11 itself unmonitored.
    expect(isFollowing({ monitored: true, seasons: seasons(false) })).toBe(false);
  });

  it("is off for an unmonitored series or one with no seasons", () => {
    expect(isFollowing({ monitored: false, seasons: seasons(true) })).toBe(false);
    expect(isFollowing({ monitored: true, seasons: [] })).toBe(false);
  });
});

describe("isUpcoming", () => {
  it("counts future and undated episodes, never specials", () => {
    expect(isUpcoming(ep(1, { airDateUtc: coming }), NOW)).toBe(true);
    expect(isUpcoming(ep(1, { airDateUtc: null }), NOW)).toBe(true);
    expect(isUpcoming(ep(1, { airDateUtc: undefined }), NOW)).toBe(true);
    expect(isUpcoming(ep(1), NOW)).toBe(false);
    expect(isUpcoming(ep(1, { seasonNumber: 0, airDateUtc: coming }), NOW)).toBe(false);
  });
});

describe("wantedMonitoring", () => {
  it("follows the switch for upcoming episodes without a file", () => {
    expect(wantedMonitoring(ep(1, { airDateUtc: coming }), true, NOW)).toBe(true);
    expect(wantedMonitoring(ep(1, { airDateUtc: coming, monitored: true }), false, NOW)).toBe(false);
  });

  it("never backfills, and never cancels what was asked for", () => {
    expect(wantedMonitoring(ep(1, { monitored: false }), true, NOW)).toBe(false);
    expect(wantedMonitoring(ep(1, { monitored: true }), false, NOW)).toBe(true);
  });
});

describe("followPlan", () => {
  it("undoes Sonarr flipping a whole season along with its flag", () => {
    // Before: E3 aired and never asked for, E4 aired and requested, E5 upcoming.
    const before = [ep(3), ep(4, { monitored: true }), ep(5, { airDateUtc: coming })];
    // After the season was set monitored, Sonarr has monitored all three.
    const after = before.map((e) => ({ ...e, monitored: true }));
    expect(followPlan(before, after, true, NOW)).toEqual({ monitor: [], unmonitor: [3] });
  });

  it("turning off keeps a requested aired episode wanted and drops the upcoming ones", () => {
    const before = [ep(4, { monitored: true }), ep(5, { airDateUtc: coming, monitored: true }), ep(6, { airDateUtc: null, monitored: true })];
    const after = before.map((e) => ({ ...e, monitored: false }));
    expect(followPlan(before, after, false, NOW)).toEqual({ monitor: [4], unmonitor: [] });
  });

  it("monitors upcoming episodes Sonarr did not flip, and one that appeared in between", () => {
    const before = [ep(10, { seasonNumber: 12, airDateUtc: null })];
    const after = [...before, ep(11, { seasonNumber: 12, airDateUtc: null })];
    expect(followPlan(before, after, true, NOW)).toEqual({ monitor: [10, 11], unmonitor: [] });
  });

  it("leaves episodes with a file as they were", () => {
    const before = [ep(1, { hasFile: true, airDateUtc: coming, monitored: true })];
    expect(followPlan(before, before, false, NOW)).toEqual({ monitor: [], unmonitor: [] });
  });
});

describe("followSeriesUpdate", () => {
  const series = {
    id: 31,
    title: "The Real Housewives of Potomac",
    monitored: true,
    monitorNewItems: "all",
    seasons: [
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 10, monitored: true },
      { seasonNumber: 11, monitored: false },
    ],
  };

  it("on: newest season monitored, new seasons wanted, everything else as it was", () => {
    const updated = followSeriesUpdate({ ...series, monitored: false, monitorNewItems: "none" }, true);
    expect(updated.monitored).toBe(true);
    expect(updated.monitorNewItems).toBe("all");
    expect(updated.seasons).toEqual([
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 10, monitored: true },
      { seasonNumber: 11, monitored: true },
    ]);
    expect(updated.title).toBe(series.title);
  });

  it("off: newest season and new seasons unwanted, the series itself still monitored", () => {
    const updated = followSeriesUpdate({ ...series, seasons: series.seasons.map((s) => ({ ...s, monitored: true })) }, false);
    expect(updated.monitored).toBe(true);
    expect(updated.monitorNewItems).toBe("none");
    expect(updated.seasons.find((s) => s.seasonNumber === 11)?.monitored).toBe(false);
    expect(updated.seasons.find((s) => s.seasonNumber === 10)?.monitored).toBe(true);
  });
});
