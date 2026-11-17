import { describe, it, expect } from "vitest";
import { unlistedDownloadRows, type UnlistedJob } from "../unlistedDownloadRows";
import { rowKey } from "../downloadGroupRules";

const REL = (n: number) => `The.Hateful.Eight.2015.Extended.Version.Chapter.${n}.2160p.NF.WEB-DL.DDP5.1.HEVC-TH8`;
const job = (n: number, state: UnlistedJob["state"], extra: Partial<UnlistedJob> = {}): UnlistedJob => ({
  nzoId: `nzo-${n}-${state}`,
  name: `[tv tmdb_320534 s1e${n} {The Hateful Eight (2019)}] ${REL(n)}`,
  state,
  progress: null,
  ...extra,
});

describe("unlistedDownloadRows", () => {
  it("draws each episode's download under the show, from search to file", () => {
    const rows = unlistedDownloadRows(
      [
        job(1, "completed", { completedAt: "2026-11-17T02:54:00.000Z", sizeBytes: 6e9 }),
        job(2, "downloading", { progress: 42 }),
        job(3, "processing"),
        job(4, "failed", { failMessage: "Aborted, cannot be completed" }),
        { nzoId: "game", name: "[game switch igdb_1] X.NSW-HR", state: "downloading", progress: 5 },
      ],
      [{ tmdbId: "320534", season: 1, episode: 5, folder: "The Hateful Eight (2019)", at: Date.parse("2026-11-17T03:00:00Z") }]
    );
    expect(rows.map((r) => [r.episodeNumber, r.completed, r.progress, r.importing ?? false, r.searching ?? false, r.noRelease ?? false])).toEqual([
      [1, true, null, false, false, false],
      [2, false, 42, false, false, false],
      [3, false, 100, true, false, false],
      [4, false, null, false, false, true],
      [5, false, null, false, true, false],
    ]);
    expect(rows.every((r) => r.seriesTitle === "The Hateful Eight" && r.externalId === -320534 && r.mediaType === "show")).toBe(true);
    expect(rows[3].notice).toBe("Download failed: Aborted, cannot be completed");
  });

  it("keeps one row per episode, the live job over an older failure, and no search row once a job exists", () => {
    const rows = unlistedDownloadRows(
      [job(1, "failed"), job(1, "downloading", { progress: 3 })],
      [{ tmdbId: "320534", season: 1, episode: 1, folder: "The Hateful Eight (2019)", at: 0 }]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].progress).toBe(3);
    expect(rows[0].unlisted).toEqual({ key: "320534:1:1", nzoId: "nzo-1-downloading" });
  });

  it("keys a row the same while it searches and once it downloads, so it never jumps", () => {
    const searching = unlistedDownloadRows([], [{ tmdbId: "320534", season: 1, episode: 2, folder: "The Hateful Eight (2019)", at: 0 }])[0];
    const downloading = unlistedDownloadRows([job(2, "downloading", { progress: 1 })], [])[0];
    expect(rowKey(searching)).toBe(rowKey(downloading));
  });
});
