import { describe, it, expect } from "vitest";
import { parseTvJobName, tvJobName, unlistedShowStatuses, type TvJob } from "../tvJobRules";

const REL = "The.Hateful.Eight.2015.Extended.Version.Chapter.1.Last.Stage.to.Red.Rock.2160p.NF.WEB-DL.DDP5.1.HEVC-TH8";

describe("tv job names", () => {
  it("round-trips the show, season and episode", () => {
    const name = tvJobName("320534", 1, 1, REL);
    expect(name).toBe(`[tv tmdb:320534 s1e1] ${REL}`);
    expect(parseTvJobName(name)).toEqual({ tmdbId: "320534", season: 1, episode: 1, release: REL });
  });

  it("reads the name back after SABnzbd swaps its colon for an underscore", () => {
    expect(parseTvJobName(`[tv tmdb_320534 s1e4] ${REL}`)).toEqual({ tmdbId: "320534", season: 1, episode: 4, release: REL });
  });

  it("ignores everything else in SABnzbd", () => {
    expect(parseTvJobName(REL)).toBeNull();
    expect(parseTvJobName("[game switch igdb:1234] Some.Game.NSW-HR")).toBeNull();
  });
});

describe("unlistedShowStatuses", () => {
  const job = (episode: number, state: TvJob["state"], progress: number | null = null, show = "320534", season = 1): TvJob => ({
    name: tvJobName(show, season, episode, REL),
    state,
    progress,
  });

  it("shows each episode's download with its progress", () => {
    expect(unlistedShowStatuses("320534", 1, [], [job(1, "downloading", 42), job(2, "queued")])).toEqual({
      1: { status: "downloading", progress: 42 },
      2: { status: "downloading", progress: 0 },
    });
  });

  it("reads a finished, not-yet-filed download as 100%, and a file on disk as available", () => {
    expect(unlistedShowStatuses("320534", 1, [3], [job(2, "completed"), job(3, "completed")])).toEqual({
      2: { status: "downloading", progress: 100 },
      3: { status: "available", progress: null },
    });
  });

  it("lets a live retry speak over an older failure, and says nothing for a failure alone", () => {
    expect(unlistedShowStatuses("320534", 1, [], [job(1, "failed"), job(1, "downloading", 5), job(4, "failed")])).toEqual({
      1: { status: "downloading", progress: 5 },
    });
  });

  it("keeps other shows and other seasons out", () => {
    expect(unlistedShowStatuses("320534", 1, [], [job(1, "downloading", 9, "999"), job(1, "downloading", 9, "320534", 2)])).toEqual({});
  });
});
