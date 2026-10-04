import { describe, expect, it } from "vitest";
import { pickFastCopies, wantsFastCopy } from "../fastCopyRules";

const entry = (o = {}) => ({ protocol: "torrent", isUpgrade: false, ageMinutes: 30, trackedDownloadState: "downloading", ...o });

describe("wantsFastCopy", () => {
  it("wants one for a torrent that has been the only download for a while", () => {
    expect(wantsFastCopy(entry())).toBe(true);
  });
  it("leaves fresh torrents, usenet, upgrades and finished downloads alone", () => {
    expect(wantsFastCopy(entry({ ageMinutes: 3 }))).toBe(false);
    expect(wantsFastCopy(entry({ protocol: "usenet" }))).toBe(false);
    expect(wantsFastCopy(entry({ isUpgrade: true }))).toBe(false);
    expect(wantsFastCopy(entry({ trackedDownloadState: "importPending" }))).toBe(false);
  });
});

describe("pickFastCopies", () => {
  const q = ["Quality for release in queue already meets cutoff: Bluray-2160p v1"];
  const rel = (title: string, o = {}) => ({ guid: title, indexerId: 1, title, protocol: "usenet", rejections: q, customFormatScore: 0, ageHours: 100, languages: [{ name: "English" }], ...o });

  it("orders single-language, then newest; skips torrents, real rejections and tried ones", () => {
    const picks = pickFastCopies(
      [
        rel("german multi", { ageHours: 10, languages: [{ name: "German" }, { name: "English" }] }),
        rel("old english", { ageHours: 9000 }),
        rel("new english", { ageHours: 50 }),
        rel("too big", { rejections: [...q, "9.3 GB is larger than maximum allowed 3.1 GB"] }),
        rel("torrent", { protocol: "torrent" }),
        rel("tried", { ageHours: 1 }),
      ],
      new Set(["tried"])
    );
    expect(picks.map((p) => p.title)).toEqual(["new english", "old english", "german multi"]);
  });
});
