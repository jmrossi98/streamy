import { describe, it, expect } from "vitest";
import { episodeLabel, wantedEpisodes } from "../wantedEpisodeRules";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const ep = (id: number, over: Partial<Parameters<typeof wantedEpisodes>[0][number]> = {}) => ({
  id,
  seasonNumber: 1,
  episodeNumber: id,
  title: `Episode ${id}`,
  monitored: true,
  hasFile: false,
  airDateUtc: "2020-01-01T00:00:00Z",
  ...over,
});

describe("episodes a requested show is still owed", () => {
  it("lists what is monitored, aired and not on disk", () => {
    expect(wantedEpisodes([ep(1), ep(2)], NOW).map((e) => e.episodeId)).toEqual([1, 2]);
  });

  it("leaves out what is downloaded or was never asked for", () => {
    const wanted = wantedEpisodes([ep(1, { hasFile: true }), ep(2, { monitored: false }), ep(3)], NOW);
    expect(wanted.map((e) => e.episodeId)).toEqual([3]);
  });

  it("does not promise an episode that has not aired", () => {
    const wanted = wantedEpisodes(
      [ep(1, { airDateUtc: "2026-11-01T00:00:00Z" }), ep(2, { airDateUtc: null }), ep(3, { airDateUtc: "not a date" })],
      NOW
    );
    expect(wanted).toEqual([]);
  });

  it("labels a row the way the search queue does", () => {
    expect(episodeLabel("Show", { seasonNumber: 3, episodeNumber: 7, title: "Reunion" })).toBe("Show - S3 E7 - Reunion");
    expect(episodeLabel("Show", { seasonNumber: 3, episodeNumber: 7, title: "" })).toBe("Show - S3 E7");
  });
});
