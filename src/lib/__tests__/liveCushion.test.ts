import { describe, expect, it } from "vitest";
import {
  BASE_CUSHION_SECONDS,
  EdgeArrivalTracker,
  GAP_MEMORY_MS,
  MAX_CUSHION_SECONDS,
  behindThreshold,
  cushionForGap,
} from "../liveCushion";

describe("EdgeArrivalTracker", () => {
  it("measures how long the edge sat still before growing", () => {
    const t = new EdgeArrivalTracker();
    t.observe(10, 0);
    expect(t.observe(10, 3_000)).toBeNull();
    expect(t.observe(16, 6_500)).toBeCloseTo(6.5);
    expect(t.longestGap(6_500)).toBeCloseTo(6.5);
  });

  it("a smooth 1s feed never records a long gap", () => {
    const t = new EdgeArrivalTracker();
    for (let i = 0; i <= 60; i++) t.observe(i, i * 1_000);
    expect(t.longestGap(60_000)).toBeCloseTo(1);
  });

  it("forgets gaps older than its memory", () => {
    const t = new EdgeArrivalTracker();
    t.observe(0, 0);
    t.observe(7, 7_000);
    expect(t.longestGap(7_000 + GAP_MEMORY_MS + 1)).toBe(0);
  });
});

describe("cushionForGap", () => {
  it("keeps the fast-tune default for a smooth feed", () => {
    expect(cushionForGap(1)).toBe(BASE_CUSHION_SECONDS);
  });
  it("covers the Boomerang-style 7s gap with margin", () => {
    expect(cushionForGap(6.9)).toBe(9);
  });
  it("is capped", () => {
    expect(cushionForGap(40)).toBe(MAX_CUSHION_SECONDS);
  });
  it("honours a remembered floor for the channel", () => {
    expect(cushionForGap(1, 9)).toBe(9);
  });
});

describe("behindThreshold", () => {
  it("is cushion + 4 for a smooth feed, as before", () => {
    expect(behindThreshold(4, 1)).toBe(8);
  });
  it("allows for a whole clump landing at once", () => {
    // cushion 9 with 7s clumps: right after one lands the viewer is ~16 behind
    // and healthy; that must not read as drift.
    expect(behindThreshold(9, 6.9)).toBeGreaterThan(9 + 6.9);
  });
});
