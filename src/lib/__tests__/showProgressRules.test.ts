import { describe, expect, it } from "vitest";
import { latestEpisodePerShow, showProgressLabel, showProgressPercent } from "@/lib/showProgressRules";

const row = (showId: string, s: number, e: number, sec: number, day: number) => ({
  showId,
  seasonNumber: s,
  episodeNumber: e,
  progressSeconds: sec,
  updatedAt: new Date(2026, 9, day),
});

describe("showProgressRules", () => {
  it("keeps the most recently watched episode per show", () => {
    expect(latestEpisodePerShow([row("1", 1, 3, 600, 1), row("1", 1, 4, 300, 5), row("2", 2, 1, 100, 2)])).toEqual({
      "1": { seasonNumber: 1, episodeNumber: 4, progressSeconds: 300 },
      "2": { seasonNumber: 2, episodeNumber: 1, progressSeconds: 100 },
    });
  });

  it("drops a show whose latest episode has no progress", () => {
    expect(latestEpisodePerShow([row("1", 1, 3, 600, 1), row("1", 1, 4, 0, 5)])).toEqual({});
  });

  it("measures against the episode runtime", () => {
    const p = { seasonNumber: 2, episodeNumber: 5, progressSeconds: 660, runtimeMinutes: 22 };
    expect(showProgressPercent(p)).toBe(50);
    expect(showProgressPercent({ ...p, runtimeMinutes: null })).toBeNull();
    expect(showProgressPercent({ ...p, progressSeconds: 99999 })).toBe(100);
    expect(showProgressLabel(p)).toBe("Resume · S2:E5");
  });
});
