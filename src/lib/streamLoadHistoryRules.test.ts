import { describe, expect, it } from "vitest";
import { countPlaying, dailyPeaks, thinSamples, type LoadSample } from "./streamLoadHistoryRules";

const sample = (at: number, playing: number, proxyMbps: number, extra: Partial<LoadSample> = {}): LoadSample => ({
  at,
  playing,
  live: 0,
  vod: playing,
  proxyMbps,
  torrentUpMbps: null,
  ...extra,
});

describe("countPlaying", () => {
  it("counts the states that hold a stream open, split live and VOD", () => {
    const now = Date.now();
    expect(
      countPlaying([
        { kind: "live", title: "CBS", state: "playing", since: now },
        { kind: "live", title: "FOX", state: "tuning", since: now },
        { kind: "episode", title: "Frieren", state: "buffering", since: now },
        { kind: "movie", title: "Heat", state: "paused", since: now },
        { kind: "movie", title: "Heat", state: "error", since: now },
        null,
      ])
    ).toEqual({ playing: 3, live: 2, vod: 1 });
  });
});

describe("dailyPeaks", () => {
  it("takes each day's busiest minute in the house's time zone", () => {
    // 03:30Z on the 18th is still the evening of the 17th in New York.
    const lateEvening = Date.UTC(2026, 9, 18, 3, 30);
    const afternoon = Date.UTC(2026, 9, 18, 19, 0);
    const peaks = dailyPeaks([
      sample(lateEvening, 2, 16.2),
      sample(lateEvening + 60_000, 3, 24.9),
      sample(afternoon, 1, 8.04),
      sample(afternoon + 60_000, 0, 0),
    ]);
    expect(peaks).toEqual([
      { day: "2026-10-17", peakPlaying: 3, peakMbps: 24.9, busyMinutes: 2 },
      { day: "2026-10-18", peakPlaying: 1, peakMbps: 8, busyMinutes: 1 },
    ]);
  });
});

describe("thinSamples", () => {
  it("keeps everything when there is room", () => {
    const s = [sample(0, 1, 1), sample(60_000, 2, 2)];
    expect(thinSamples(s, 10)).toBe(s);
  });

  it("keeps the busiest reading of each bin, not the average", () => {
    const s = Array.from({ length: 100 }, (_, i) => sample(i * 60_000, i === 42 ? 4 : 1, i === 42 ? 33 : 8));
    const thinned = thinSamples(s, 10);
    expect(thinned).toHaveLength(10);
    expect(Math.max(...thinned.map((x) => x.playing))).toBe(4);
    expect(Math.max(...thinned.map((x) => x.proxyMbps))).toBe(33);
  });
});
