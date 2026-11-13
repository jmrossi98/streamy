import { describe, expect, it } from "vitest";
import { describeTestRelease, pickTestRelease, summarizeReleases, type TestReleaseCandidate } from "../playbackCheckRules";

const GB = 1024 ** 3;

function rel(over: Partial<TestReleaseCandidate>): TestReleaseCandidate {
  return { guid: "g", indexerId: 1, title: "t", protocol: "usenet", size: 2 * GB, rejected: false, rejections: [], seeders: null, ...over };
}

describe("pickTestRelease", () => {
  // What Radarr's search returned on 2026-11-13, roughly: the 720p usenet copies
  // rejected for size, a 1.8 GB 1080p usenet copy, and small 720p torrents.
  const search = [
    rel({ title: "NOTLD.720p.bluray.x264-hv", size: 5.4 * GB, rejected: true, rejections: ["5.4 GB is larger than maximum allowed 2.4 GB"] }),
    rel({ title: "NOTLD.REMASTERED.1080p.BluRay.x265", size: 1.8 * GB }),
    rel({ title: "NOTLD.BluRay.1080p.PCM-1.H265-d3g", size: 3.1 * GB }),
    rel({ title: "NOTLD.REMASTERED.720p.BluRay.H264.AAC-RARBG", protocol: "torrent", size: 1.3 * GB, seeders: 2 }),
    rel({ title: "NOTLD.720p.BRRip.x264-x0r", protocol: "torrent", size: 0.9 * GB, seeders: 40 }),
  ];

  it("takes the smallest acceptable usenet copy over any torrent", () => {
    expect(pickTestRelease(search)?.title).toBe("NOTLD.REMASTERED.1080p.BluRay.x265");
  });

  it("without usenet, the best-seeded torrent -- never a near-dead one", () => {
    const torrents = search.filter((r) => r.protocol === "torrent");
    expect(pickTestRelease(torrents)?.title).toBe("NOTLD.720p.BRRip.x264-x0r");
    expect(pickTestRelease(torrents.filter((r) => (r.seeders ?? 0) < 5))).toBeNull();
  });

  it("a torrent fallback is a small one", () => {
    const big = rel({ title: "NOTLD.1080p.X264-AMIABLE", protocol: "torrent", size: 9.8 * GB, seeders: 60 });
    const small = rel({ title: "NOTLD.720p.x264", protocol: "torrent", size: 1.1 * GB, seeders: 8 });
    expect(pickTestRelease([big, small])?.title).toBe("NOTLD.720p.x264");
    expect(pickTestRelease([big])).toBeNull();
  });

  it("skips samples, fakes and anything too big for the window", () => {
    expect(pickTestRelease([rel({ size: 50 * 1024 ** 2 }), rel({ size: 40 * GB })])).toBeNull();
  });

  it("never a piece of a split upload or a sample", () => {
    // The smallest usenet "copy" on 2026-11-13 was part 1 of a split upload.
    const split = rel({ title: "Night of the Living Dead (1968) 3X-audio Remastered x264 aac.part01", size: 0.6 * GB });
    expect(pickTestRelease([split, ...search])?.title).toBe("NOTLD.REMASTERED.1080p.BluRay.x265");
    expect(summarizeReleases([split, ...search])).toBe(
      "6 found, usable: 2 usenet, 2 torrent; most often rejected: N is larger than maximum allowed N (1)"
    );
  });

  it("describes the pick for the run's detail", () => {
    expect(describeTestRelease({ title: "X", protocol: "usenet", size: 1.8 * GB })).toBe("X (usenet, 1.8 GB)");
  });
});
