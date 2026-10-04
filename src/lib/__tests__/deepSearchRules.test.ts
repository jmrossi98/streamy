import { describe, expect, it } from "vitest";
import { pickDeepRelease } from "../deepSearchRules";

const rel = (title: string, o: Partial<Parameters<typeof pickDeepRelease>[0][number]> = {}) => ({
  guid: title,
  indexerId: 1,
  title,
  protocol: "torrent",
  seeders: 5,
  rejected: false,
  rejections: [],
  qualityWeight: 100,
  customFormatScore: 0,
  ...o,
});

describe("pickDeepRelease", () => {
  it("takes the best release Radarr accepts", () => {
    const pick = pickDeepRelease([
      rel("720p", { qualityWeight: 600 }),
      rel("1080p", { qualityWeight: 900 }),
      rel("4k rejected", { qualityWeight: 1900, rejected: true, rejections: ["Not enough seeders: 0. Minimum seeders: 1"] }),
    ]);
    expect(pick?.title).toBe("1080p");
  });

  it("falls back to a seeded release whose only problem is an untagged quality", () => {
    // The Scary Godmother case, as Radarr returned it on 2026-10-04.
    const pick = pickDeepRelease([
      rel("DVDRIP", { seeders: 0, rejected: true, rejections: ["Not enough seeders: 0. Minimum seeders: 1"] }),
      rel("archive copy", { seeders: 1, rejected: true, rejections: ["Unknown is not wanted in profile"] }),
      rel("garbled", { seeders: 0, rejected: true, rejections: ["Unable to parse release"] }),
    ]);
    expect(pick?.title).toBe("archive copy");
  });

  it("takes a thinly seeded release as a last resort, best-seeded first", () => {
    const pick = pickDeepRelease([
      rel("two seeds", { seeders: 2, rejected: true, rejections: ["Not enough seeders: 2. Minimum seeders: 5"] }),
      rel("four seeds", { seeders: 4, rejected: true, rejections: ["Not enough seeders: 4. Minimum seeders: 5"] }),
      rel("none", { seeders: 0, rejected: true, rejections: ["Not enough seeders: 0. Minimum seeders: 5"] }),
    ]);
    expect(pick?.title).toBe("four seeds");
  });

  it("never takes an unseeded, unparseable or otherwise rejected release", () => {
    expect(
      pickDeepRelease([
        rel("dead", { seeders: 0, rejected: true, rejections: ["Unknown is not wanted in profile"] }),
        rel("two problems", { rejected: true, rejections: ["Unknown is not wanted in profile", "Release in blocklist"] }),
        rel("garbled", { rejected: true, rejections: ["Unable to parse release"] }),
      ])
    ).toBeNull();
  });
});
