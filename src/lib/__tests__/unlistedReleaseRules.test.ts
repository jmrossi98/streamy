import { describe, it, expect } from "vitest";
import {
  distinctiveTitle,
  episodeSearches,
  languageOf,
  matchesUnlistedEpisode,
  rankUnlistedReleases,
  resolutionOf,
  showQuery,
  type UnlistedEpisode,
  type UnlistedResult,
} from "../unlistedReleaseRules";

// The Hateful Eight: Extended Version (TMDB tv 320534) -- no TVDB entry, so
// nothing but these rules decides which release is which chapter.
const H8 = (episode: number, episodeTitle: string): UnlistedEpisode => ({
  show: "The Hateful Eight",
  originalLanguage: "en",
  season: 1,
  episode,
  episodeTitle,
  runtimeMinutes: 52,
});
const CH1 = H8(1, "Last Stage to Red Rock");
const CH2 = H8(2, "Minnie's Haberdashery");
const CH4 = H8(4, "The Last Chapter");

describe("matchesUnlistedEpisode", () => {
  it("knows a chapter by its title when the release names no episode", () => {
    const ch1 = "The.Hateful.Eight.2015.Extended.Version.Chapter.1.Last.Stage.to.Red.Rock.2160p.NF.WEB-DL.DDP5.1.HEVC-TH8";
    expect(matchesUnlistedEpisode(ch1, CH1)).toBe(true);
    expect(matchesUnlistedEpisode(ch1, CH2)).toBe(false);
    expect(matchesUnlistedEpisode("The.Hateful.Eight.2015.Extended.Version.Chapter.2.Minnies.Haberdashery.1080p.NF.WEB-DL.DDP5.1.HEVC-MZABI", CH2)).toBe(true);
    expect(matchesUnlistedEpisode("The.Hateful.Eight.2015.Extended.Version.Chapter.4.The.Last.Chapter.2160p.NF.WEB-DL.DDP5.1.HEVC-TH8", CH4)).toBe(true);
  });

  it("never takes another show's episode that shares the name", () => {
    expect(matchesUnlistedEpisode("Crew.Girl.S01E02.The.Hateful.Eight.1080p.NF.WEB-DL.DD+5.1.Atmos.H.264-playWEB", CH2)).toBe(false);
    expect(matchesUnlistedEpisode("Crew.Girl.S01E02.The.Hateful.Eight.1080p.NF.WEB-DL.DD+5.1.Atmos.H.264-playWEB", CH1)).toBe(false);
  });

  it("takes this episode by its number when the show's own name comes first, a year allowed", () => {
    expect(matchesUnlistedEpisode("The.Hateful.Eight.S01E01.1080p.WEB.h264-GRP", CH1)).toBe(true);
    expect(matchesUnlistedEpisode("Hateful.Eight.2019.S01E01.720p.WEB.h264-GRP", CH1)).toBe(true);
    expect(matchesUnlistedEpisode("The.Hateful.Eight.S01E03.1080p.WEB.h264-GRP", CH1)).toBe(false);
    expect(matchesUnlistedEpisode("The.Hateful.Eight.Behind.The.Scenes.S01E01.1080p.WEB.h264-GRP", CH1)).toBe(false);
  });

  it("leaves out packs, double episodes and samples", () => {
    expect(matchesUnlistedEpisode("The.Hateful.Eight.S01.1080p.NF.WEB-DL-GRP", CH1)).toBe(false);
    expect(matchesUnlistedEpisode("The.Hateful.Eight.S01E01E02.1080p.WEB-GRP", CH1)).toBe(false);
    expect(matchesUnlistedEpisode("The.Hateful.Eight.S01E01.1080p.WEB-GRP.sample", CH1)).toBe(false);
    expect(matchesUnlistedEpisode("The Hateful Eight 2015 Extended Version 1080p WEBRip X264 Ac3 SNAKE", CH1)).toBe(false);
  });

  it("needs a title that could not match by chance", () => {
    const generic = { ...CH1, episodeTitle: "Episode 1" };
    expect(matchesUnlistedEpisode("The.Hateful.Eight.Episode.1.1080p.WEB-GRP", generic)).toBe(false);
    expect(distinctiveTitle("Pilot")).toBe(false);
    expect(distinctiveTitle("Chapter 3")).toBe(false);
    expect(distinctiveTitle("The Last Chapter")).toBe(true);
    expect(distinctiveTitle("Haberdashery")).toBe(true);
  });
});

describe("searches", () => {
  it("asks for titles the way release names spell them -- no apostrophes", () => {
    expect(episodeSearches(CH2)).toEqual(["The Hateful Eight S01E02", "The Hateful Eight Minnies Haberdashery"]);
    expect(episodeSearches(H8(3, "Domergue's Got a Secret"))[1]).toBe("The Hateful Eight Domergues Got a Secret");
    expect(showQuery("Star Wars: Andor")).toBe("Star Wars Andor");
  });

  it("skips the title search when the title is not distinctive", () => {
    expect(episodeSearches({ ...CH1, episodeTitle: "Episode 1" })).toEqual(["The Hateful Eight S01E01"]);
  });
});

describe("languageOf", () => {
  it("drops a dub, keeps a release with the original alongside", () => {
    expect(languageOf("Show.S01E01.GERMAN.1080p.WEB.h264-GRP", "en")).toBe("foreign");
    expect(languageOf("Show.S01E01.GERMAN.DL.1080p.WEB.h264-GRP", "en")).toBe("mixed");
    expect(languageOf("Show [2022] S01E01 Title 1080p NF WEBDL H264 [TRSub] DDP 51 TSRG", "en")).toBe("foreign");
    expect(languageOf("Show.S01E01.1080p.NF.WEB-DL.DDP5.1.H.264-GRP", "en")).toBe("clean");
  });

  it("never calls the show's own language foreign", () => {
    expect(languageOf("Anime.S01E01.JAPANESE.1080p.WEB.h264-GRP", "ja")).toBe("clean");
  });
});

describe("resolutionOf", () => {
  it("reads the name, else guesses from size per minute", () => {
    expect(resolutionOf("X.2160p.NF.WEB-DL", 6e9, 52)).toBe(2160);
    expect(resolutionOf("X.720p.HDTV", 1e9, 52)).toBe(720);
    expect(resolutionOf("X.WEBRip-GRP", 0.8e9, 52)).toBe(480);
    expect(resolutionOf("X.WEBRip-GRP", 3e9, 52)).toBe(1080);
  });
});

describe("rankUnlistedReleases", () => {
  const r = (title: string, gb: number, grabs = 0, protocol = "usenet"): UnlistedResult => ({
    title,
    size: gb * 1e9,
    grabs,
    protocol,
    downloadUrl: `http://prowlarr/${encodeURIComponent(title)}`,
  });
  const releases = [
    r("The.Hateful.Eight.2015.Extended.Version.Chapter.1.Last.Stage.to.Red.Rock.1080p.NF.WEB-DL.DDP5.1.HEVC-MZABI", 2.4, 767),
    r("The.Hateful.Eight.2015.Extended.Version.Chapter.1.Last.Stage.to.Red.Rock.2160p.NF.WEB-DL.DDP5.1.HEVC-TH8", 6.4, 290),
    r("The.Hateful.Eight.2015.Extended.Version.Chapter.1.Last.Stage.to.Red.Rock.720p.NF.WEB-DL.DDP5.1.H.264-GRP", 1.2, 10),
    r("The.Hateful.Eight.2015.Extended.Version.Chapter.1.Last.Stage.to.Red.Rock.2160p.NF.WEB-DL.DDP5.1.HEVC-TOR", 6.4, 900, "torrent"),
    r("Crew.Girl.S01E02.The.Hateful.Eight.2160p.NF.WEB-DL.DD+5.1.Atmos.H.265-playWEB", 7.2, 42),
  ];

  it("puts 4K first for an admin's request and 720p first for everyone else's", () => {
    expect(rankUnlistedReleases(releases, CH1, "uhd").map((x) => x.title.match(/(\d{3,4}p)/)?.[1])).toEqual(["2160p", "1080p", "720p"]);
    expect(rankUnlistedReleases(releases, CH1, "hd").map((x) => x.title.match(/(\d{3,4}p)/)?.[1])).toEqual(["720p", "1080p", "2160p"]);
  });

  it("takes usenet only, and nothing that is not this episode", () => {
    const ranked = rankUnlistedReleases(releases, CH1, "uhd");
    expect(ranked.some((x) => x.protocol !== "usenet")).toBe(false);
    expect(ranked.some((x) => x.title.startsWith("Crew.Girl"))).toBe(false);
  });

  it("prefers a clean release over a dual-language one at the same quality, then the most grabbed", () => {
    const ep = { ...CH1, show: "Show", episodeTitle: null };
    const ranked = rankUnlistedReleases(
      [r("Show.S01E01.GERMAN.DL.1080p.WEB.h264-A", 2, 999), r("Show.S01E01.1080p.WEB.h264-B", 2, 5), r("Show.S01E01.1080p.WEB.h264-C", 2, 50)],
      ep,
      "uhd"
    );
    expect(ranked.map((x) => x.title.slice(-1))).toEqual(["C", "B", "A"]);
  });

  it("skips a remux far past what an episode needs, and anything too small to be one", () => {
    const ep = { ...CH1, show: "Show", episodeTitle: null };
    expect(rankUnlistedReleases([r("Show.S01E01.2160p.REMUX-X", 40), r("Show.S01E01.720p-Y", 0.01)], ep, "uhd")).toEqual([]);
  });
});
