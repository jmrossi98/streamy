import { describe, it, expect } from "vitest";
import {
  isSameSeries,
  overrideLanguages,
  pickUnmatchedSeasonPack,
  rollUpSeason,
  type SeasonRelease,
} from "../seasonDeepSearchRules";

const fanny = { titles: ["Fanny and Alexander", "Fanny und Alexander"], year: 1984, seasonNumber: 1 };

function pack(over: Partial<SeasonRelease> = {}): SeasonRelease {
  return {
    guid: "g1",
    indexerId: 5,
    title: "Fanny and Alexander (1983) Criterion Season 1 S01 (1080p BluRay x265 HEVC 10bit AAC 1 0 Swedish Tigole)",
    protocol: "torrent",
    seeders: 13,
    rejected: true,
    rejections: ["Unknown Series"],
    seriesTitle: "Fanny and Alexander (1983) Criterion",
    seasonNumber: 1,
    fullSeason: true,
    qualityWeight: 1201,
    ...over,
  };
}

describe("isSameSeries", () => {
  it("accepts the title followed by a neighbouring year and edition words", () => {
    expect(isSameSeries("Fanny and Alexander (1983) Criterion", fanny)).toBe(true);
    expect(isSameSeries("Fanny-and-Alexander-(1983)-Criterion", fanny)).toBe(true);
    expect(isSameSeries("Fanny & Alexander", fanny)).toBe(true);
    expect(isSameSeries("Fanny und Alexander 1984", fanny)).toBe(true);
  });

  it("refuses a different work that merely starts the same way", () => {
    expect(isSameSeries("Fanny and Alexander Revisited", fanny)).toBe(false);
    expect(isSameSeries("Fanny and Alexander 2019", fanny)).toBe(false);
    expect(isSameSeries("Fanny", fanny)).toBe(false);
    expect(isSameSeries("", fanny)).toBe(false);
  });
});

describe("pickUnmatchedSeasonPack", () => {
  it("takes the better-seeded copy of a pack Sonarr could not place", () => {
    const picked = pickUnmatchedSeasonPack([pack({ guid: "lime", seeders: 9 }), pack({ guid: "td", seeders: 13 })], fanny);
    expect(picked?.guid).toBe("td");
  });

  it("leaves alone anything rejected for another reason, or not this season's full pack", () => {
    expect(pickUnmatchedSeasonPack([pack({ rejections: ["Unknown Series", "Release is blocklisted"] })], fanny)).toBeNull();
    expect(pickUnmatchedSeasonPack([pack({ rejections: [] })], fanny)).toBeNull();
    expect(pickUnmatchedSeasonPack([pack({ seasonNumber: 2 })], fanny)).toBeNull();
    expect(pickUnmatchedSeasonPack([pack({ fullSeason: false })], fanny)).toBeNull();
    expect(pickUnmatchedSeasonPack([pack({ seeders: 0 })], fanny)).toBeNull();
    expect(pickUnmatchedSeasonPack([pack({ seriesTitle: "Fanny and Alexander Revisited" })], fanny)).toBeNull();
  });
});

describe("overrideLanguages", () => {
  const swedish = { id: 14, name: "Swedish" };
  it("keeps what the release name said, else the series' original language", () => {
    expect(overrideLanguages({ languages: [swedish] }, { id: 1, name: "English" })).toEqual([swedish]);
    expect(overrideLanguages({ languages: [{ id: 0, name: "Unknown" }] }, swedish)).toEqual([swedish]);
  });
});

describe("rollUpSeason", () => {
  const s = (status: "requested" | "noReleaseFound" | "downloading" | "available", progress: number | null = null) => ({
    status,
    progress,
  });

  it("is not Downloaded when every search came up empty", () => {
    // Regression: Fanny and Alexander read "Downloaded" with nothing on disk.
    expect(rollUpSeason([1, 2], { 1: s("noReleaseFound"), 2: s("noReleaseFound") })?.status).toBe("noReleaseFound");
  });

  it("offers the retry when only some episodes are missing", () => {
    expect(rollUpSeason([1, 2], { 1: s("available"), 2: s("noReleaseFound") })?.status).toBe("noReleaseFound");
  });

  it("is Downloaded only when every episode is", () => {
    expect(rollUpSeason([1, 2], { 1: s("available"), 2: s("available") })?.status).toBe("available");
  });

  it("puts activity first and averages known progress", () => {
    expect(rollUpSeason([1, 2, 3], { 1: s("downloading", 40), 2: s("downloading", 60), 3: s("noReleaseFound") })).toEqual({
      status: "downloading",
      progress: 50,
    });
    expect(rollUpSeason([1, 2], { 1: s("requested"), 2: s("noReleaseFound") })?.status).toBe("requested");
  });

  it("has no state until every episode has one", () => {
    expect(rollUpSeason([1, 2], { 1: s("available") })).toBeUndefined();
    expect(rollUpSeason([], {})).toBeUndefined();
  });
});
