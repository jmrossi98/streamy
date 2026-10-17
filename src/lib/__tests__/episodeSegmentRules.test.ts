import { describe, expect, it } from "vitest";
import {
  continuingStart,
  inCredits,
  NO_SEGMENTS,
  parseSegments,
  shouldAskStillWatching,
  skipOfferAt,
} from "../episodeSegmentRules";

const T = 10_000_000;
const RUNTIME = 1320 * T; // a 22-minute episode

describe("parseSegments", () => {
  it("reads Jellyfin's segments in seconds", () => {
    const segs = parseSegments(
      [
        { Type: "Intro", StartTicks: 30 * T, EndTicks: 60 * T },
        { Type: "Recap", StartTicks: 0, EndTicks: 25 * T },
        { Type: "Outro", StartTicks: 1260 * T, EndTicks: 1320 * T },
        { Type: "Commercial", StartTicks: 600 * T, EndTicks: 630 * T },
      ],
      [],
      RUNTIME
    );
    expect(segs).toEqual({ intro: { start: 30, end: 60 }, recap: { start: 0, end: 25 }, credits: { start: 1260, end: 1320 } });
  });

  it("falls back to chapter names, each running to the next chapter", () => {
    const segs = parseSegments(
      null,
      [
        { Name: "Chapter 1", StartPositionTicks: 0 },
        { Name: "Intro", StartPositionTicks: 40 * T },
        { Name: "Chapter 2", StartPositionTicks: 70 * T },
        { Name: "Credits", StartPositionTicks: 1280 * T },
      ],
      RUNTIME
    );
    expect(segs.intro).toEqual({ start: 40, end: 70 });
    expect(segs.credits).toEqual({ start: 1280, end: 1320 });
  });

  it("prefers segments over chapters", () => {
    const segs = parseSegments(
      [{ Type: "Intro", StartTicks: 10 * T, EndTicks: 50 * T }],
      [{ Name: "Opening", StartPositionTicks: 0 }, { Name: "Part A", StartPositionTicks: 90 * T }],
      RUNTIME
    );
    expect(segs.intro).toEqual({ start: 10, end: 50 });
  });

  it("does not read 'Intro End' or ordinary chapter names as markers", () => {
    const segs = parseSegments(null, [{ Name: "Intro End", StartPositionTicks: 0 }, { Name: "Chapter 5", StartPositionTicks: 1200 * T }], RUNTIME);
    expect(segs).toEqual(NO_SEGMENTS);
  });

  it("ignores credits in the first half, and spans too short to skip", () => {
    const segs = parseSegments(
      [
        { Type: "Outro", StartTicks: 300 * T, EndTicks: 400 * T },
        { Type: "Intro", StartTicks: 10 * T, EndTicks: 12 * T },
      ],
      [],
      RUNTIME
    );
    expect(segs).toEqual(NO_SEGMENTS);
  });
});

describe("skipOfferAt", () => {
  const segs = { intro: { start: 30, end: 60 }, recap: { start: 0, end: 25 }, credits: null };
  it("offers the span being played", () => {
    expect(skipOfferAt(5, segs)).toEqual({ kind: "recap", label: "Skip recap", to: 25 });
    expect(skipOfferAt(30, segs)).toEqual({ kind: "intro", label: "Skip intro", to: 60 });
  });
  it("offers nothing outside them, or in a span's last second", () => {
    expect(skipOfferAt(27, segs)).toBeNull();
    expect(skipOfferAt(59.5, segs)).toBeNull();
    expect(skipOfferAt(100, NO_SEGMENTS)).toBeNull();
  });
});

describe("inCredits", () => {
  it("is true from the credits' start", () => {
    const segs = { ...NO_SEGMENTS, credits: { start: 1260, end: 1320 } };
    expect(inCredits(1259, segs)).toBe(false);
    expect(inCredits(1260, segs)).toBe(true);
    expect(inCredits(1300, NO_SEGMENTS)).toBe(false);
  });
});

describe("continuingStart", () => {
  const segs = { ...NO_SEGMENTS, credits: { start: 1260, end: 1320 } };
  it("keeps a spot partway through", () => {
    expect(continuingStart(400, 1320, segs)).toBe(400);
  });
  it("starts a finished episode over", () => {
    expect(continuingStart(1270, 1320, segs)).toBe(0);
    expect(continuingStart(1200, 1320, NO_SEGMENTS)).toBe(0);
    expect(continuingStart(0, 1320, segs)).toBe(0);
  });
});

describe("shouldAskStillWatching", () => {
  it("asks after three episodes nobody touched", () => {
    expect(shouldAskStillWatching(2)).toBe(false);
    expect(shouldAskStillWatching(3)).toBe(true);
  });
});
