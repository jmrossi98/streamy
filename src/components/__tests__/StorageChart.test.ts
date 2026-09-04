import { describe, it, expect } from "vitest";
import { buildStorageSegments } from "../StorageChart";

const GB = 1024 ** 3;

describe("buildStorageSegments", () => {
  it("derives Other from what Radarr and Sonarr don't account for", () => {
    // 100 total, 40 free => 60 used; 30 movies + 10 tv leaves 20 as Other
    // (OS, Docker, and torrent data not shared with an imported file).
    const { bars } = buildStorageSegments(100 * GB, 40 * GB, 30 * GB, 10 * GB);
    const other = bars.find((b) => b.key === "other");
    expect(other?.value).toBe(20 * GB);
  });

  it("never reports negative Other when the numbers disagree", () => {
    // Radarr and Sonarr sizes can briefly exceed used space mid-import.
    const { bars } = buildStorageSegments(100 * GB, 40 * GB, 80 * GB, 40 * GB);
    expect(bars.find((b) => b.key === "other")).toBeUndefined();
  });

  it("omits segments that hold nothing", () => {
    const { bars } = buildStorageSegments(100 * GB, 70 * GB, 30 * GB, 0);
    expect(bars.map((b) => b.key)).not.toContain("tv");
  });

  it("keeps a real but tiny segment visible", () => {
    // Regression: 1.5 GB of movies on a 98 GB disk rendered as an
    // imperceptible sliver. The true percentage is still reported.
    const { bars } = buildStorageSegments(98 * GB, 96 * GB, 1.5 * GB, 0);
    const movies = bars.find((b) => b.key === "movies");
    expect(movies!.pct).toBeCloseTo(1.53, 1);
    expect(movies!.width).toBeGreaterThanOrEqual(1.5);
    expect(movies!.width).toBeGreaterThan(movies!.pct - 0.01);
  });

  it("reports used space and percentage from free space", () => {
    const { used, usedPercent } = buildStorageSegments(100 * GB, 25 * GB, 50 * GB, 25 * GB);
    expect(used).toBe(75 * GB);
    expect(usedPercent).toBeCloseTo(75, 5);
  });

  it("does not divide by zero on an unknown disk size", () => {
    const { bars, usedPercent } = buildStorageSegments(0, 0, 0, 0);
    expect(usedPercent).toBe(0);
    expect(bars).toEqual([]);
  });

  it("keeps total rendered width within the bar", () => {
    const { usedWidth } = buildStorageSegments(100 * GB, 40 * GB, 30 * GB, 10 * GB);
    expect(usedWidth).toBeLessThanOrEqual(100);
  });

  it("folds games into Other's calculation when provided", () => {
    // 100 total, 40 free => 60 used; 30 movies + 10 tv + 15 games leaves 5 as
    // Other -- omitting the new gamesSize arg entirely (every call above)
    // must keep behaving exactly as before, which the other tests already
    // pin; this one is the case where it's actually passed.
    const { bars } = buildStorageSegments(100 * GB, 40 * GB, 30 * GB, 10 * GB, 15 * GB);
    expect(bars.find((b) => b.key === "games")?.value).toBe(15 * GB);
    expect(bars.find((b) => b.key === "other")?.value).toBe(5 * GB);
  });
});
