import { describe, it, expect } from "vitest";
import { episodeLabel, placeFromLabel, wantedEpisodes, wholeShowEpisodes } from "../wantedEpisodeRules";

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

describe("placing a row from its own label", () => {
  it("reads back what episodeLabel wrote", () => {
    const label = episodeLabel("Vanderpump Rules", { seasonNumber: 1, episodeNumber: 2, title: "This Is Break-up" });
    expect(placeFromLabel(label)).toEqual({ seriesTitle: "Vanderpump Rules", seasonNumber: 1, episodeNumber: 2 });
  });

  it("copes with a title containing a dash and an episode with no title", () => {
    expect(placeFromLabel("Frieren - Beyond - S1 E28")).toEqual({ seriesTitle: "Frieren - Beyond", seasonNumber: 1, episodeNumber: 28 });
  });

  it("says nothing about a release name", () => {
    expect(placeFromLabel("Vanderpump.Rules.S01E02.1080p.WEB")).toBeNull();
  });
});

describe("what a whole-show request covers", () => {
  const e = (seasonNumber: number, episodeNumber: number, hasFile = false) => ({ seasonNumber, episodeNumber, hasFile });

  it("is every missing regular episode in broadcast order", () => {
    expect(wholeShowEpisodes([e(2, 1), e(1, 2), e(1, 1, true), e(1, 3)])).toEqual([e(1, 2), e(1, 3), e(2, 1)]);
  });

  it("never includes the specials, so cancelled Extras are not asked for again", () => {
    expect(wholeShowEpisodes([e(0, 1), e(0, 2), e(1, 1)])).toEqual([e(1, 1)]);
  });
});
