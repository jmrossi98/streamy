import { describe, it, expect } from "vitest";
import { episodeQueries, inferQualityTag, movieQueries, namesEpisode, pushTitle, rankTextResults } from "../textSearchRules";

describe("episodeQueries", () => {
  it("asks by number, then by episode title", () => {
    expect(episodeQueries("The Real Housewives of Atlanta", 4, 20, "Happiness and Joy")).toEqual([
      "The Real Housewives of Atlanta S04E20",
      "The Real Housewives of Atlanta Happiness and Joy",
    ]);
  });
  it("skips a generic episode title", () => {
    expect(episodeQueries("Show", 1, 5, "Episode 5")).toEqual(["Show S01E05"]);
    expect(episodeQueries("Show", 1, 5, "TBA")).toEqual(["Show S01E05"]);
    expect(episodeQueries("Show", 1, 5, null)).toEqual(["Show S01E05"]);
  });
});

describe("namesEpisode", () => {
  it("matches this episode only", () => {
    expect(namesEpisode("The.Real.Housewives.of.Atlanta.S04E20.Happiness.and.Joy", 4, 20)).toBe(true);
    expect(namesEpisode("show 4x20 hdtv", 4, 20)).toBe(true);
    expect(namesEpisode("Show.S04E02.720p", 4, 20)).toBe(false);
    expect(namesEpisode("Show.S04E201.720p", 4, 20)).toBe(false);
    expect(namesEpisode("Show.S14E20.720p", 4, 20)).toBe(false);
  });
  it("leaves out multi-episode files", () => {
    expect(namesEpisode("Show.S04E20E21.720p", 4, 20)).toBe(false);
    expect(namesEpisode("Show.S04E20-E21.720p", 4, 20)).toBe(false);
  });
});

describe("rankTextResults", () => {
  it("puts usenet first, drops unseeded torrents and links-less results", () => {
    const ranked = rankTextResults([
      { title: "t0", protocol: "torrent", seeders: 0, downloadUrl: "x" },
      { title: "t3", protocol: "torrent", seeders: 3, downloadUrl: "x" },
      { title: "u", protocol: "usenet", downloadUrl: "x" },
      { title: "nolink", protocol: "usenet" },
    ]);
    expect(ranked.map((r) => r.title)).toEqual(["u", "t3"]);
  });
});

describe("inferQualityTag", () => {
  it("guesses from size per minute", () => {
    expect(inferQualityTag(0.91e9, 42)).toBe("HDTV");
    expect(inferQualityTag(1.2e9, 42)).toBe("720p.HDTV");
    expect(inferQualityTag(2.9e9, 42)).toBe("1080p.WEB-DL");
  });
  it("assumes 42 minutes when the runtime is unknown", () => {
    expect(inferQualityTag(0.91e9, null)).toBe("HDTV");
    expect(inferQualityTag(0.91e9, 0)).toBe("HDTV");
  });
});

describe("pushTitle", () => {
  it("tags only a name the parser found no quality in", () => {
    expect(pushTitle("Show.S04E20.Title", "Unknown", 0.91e9, 42)).toBe("Show.S04E20.Title.HDTV");
    expect(pushTitle("Show.S04E20.Title", null, 2.9e9, 42)).toBe("Show.S04E20.Title.1080p.WEB-DL");
    expect(pushTitle("Show.S04E20.720p.HDTV", "HDTV-720p", 1.2e9, 42)).toBe("Show.S04E20.720p.HDTV");
  });
});

describe("movieQueries", () => {
  it("adds the year when known", () => {
    expect(movieQueries("Scary Godmother", 2003)).toEqual(["Scary Godmother 2003"]);
    expect(movieQueries("Scary Godmother", null)).toEqual(["Scary Godmother"]);
  });
});
