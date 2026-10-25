import { describe, expect, it } from "vitest";
import {
  inCredits,
  isFinished,
  NO_SEGMENTS,
  parseSegments,
  shouldAskStillWatching,
  skipOfferAt,
  startPoint,
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

  it("reads an early, short 'Credits' chapter as the opening titles (Clone High)", () => {
    // S1E1 and S1E9 as Jellyfin reports them.
    const e1 = parseSegments(null, [{ Name: "Credits", StartPositionTicks: 0 }, { Name: "Chapter 2", StartPositionTicks: 38 * T }], 1290 * T);
    expect(e1).toEqual({ intro: { start: 0, end: 38 }, recap: null, credits: null });
    const e9 = parseSegments(null, [{ Name: "Chapter 1", StartPositionTicks: 0 }, { Name: "Credits", StartPositionTicks: 64 * T }, { Name: "Chapter 2", StartPositionTicks: 98 * T }], 1291 * T);
    expect(e9.intro).toEqual({ start: 64, end: 98 });
  });

  it("ignores chapters that share a start time (Clone High S1E5: its theme is really 0:22-0:56)", () => {
    const e5 = parseSegments(null, [{ Name: "Chapter 1", StartPositionTicks: 0 }, { Name: "Credits", StartPositionTicks: 0 }, { Name: "Chapter 2", StartPositionTicks: 22 * T }], 1290 * T);
    expect(e5).toEqual(NO_SEGMENTS);
  });

  it("still reads late credits as credits, and a long early chapter as neither", () => {
    const late = parseSegments(null, [{ Name: "Chapter 1", StartPositionTicks: 0 }, { Name: "Credits", StartPositionTicks: 1250 * T }], RUNTIME);
    expect(late).toEqual({ intro: null, recap: null, credits: { start: 1250, end: 1320 } });
    const long = parseSegments(null, [{ Name: "Credits", StartPositionTicks: 0 }, { Name: "Chapter 2", StartPositionTicks: 300 * T }], RUNTIME);
    expect(long).toEqual(NO_SEGMENTS);
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

describe("recaps and previews", () => {
  const seg = (Type: string, a: number, b: number) => ({ Type, StartTicks: a * T, EndTicks: b * T });
  it("drops a recap in an episode 1: Edgerunners S1E1's cold open was marked as one", () => {
    const segs = [seg("Recap", 0, 123)];
    expect(parseSegments(segs, null, RUNTIME, 1).recap).toBeNull();
    expect(parseSegments(segs, null, RUNTIME, 2).recap).toEqual({ start: 0, end: 123 });
    expect(parseSegments(segs, null, RUNTIME).recap).toEqual({ start: 0, end: 123 });
  });
  it("drops a recap that starts well into the episode", () => {
    expect(parseSegments([seg("Recap", 40, 90)], null, RUNTIME, 3).recap).toBeNull();
  });
  it("reads a Next-time preview as the start of the outro, merged with the credits after it", () => {
    const ep = 2564 * T;
    expect(parseSegments([seg("Preview", 2532, 2558)], null, ep).credits).toEqual({ start: 2532, end: 2558 });
    expect(parseSegments([seg("Preview", 2532, 2548), seg("Outro", 2548, 2564)], null, ep).credits).toEqual({ start: 2532, end: 2564 });
    expect(parseSegments([seg("Outro", 2548, 2564), seg("Preview", 2532, 2548)], null, ep).credits).toEqual({ start: 2532, end: 2564 });
  });
});

describe("skipOfferAt", () => {
  const segs = { intro: { start: 30, end: 60 }, recap: { start: 0, end: 25 }, credits: null };
  it("offers the intro while it plays", () => {
    expect(skipOfferAt(30, segs)).toEqual({ kind: "intro", label: "Skip intro", to: 60 });
  });
  it("offers the recap while it plays (Real Housewives: a recap and no intro)", () => {
    expect(skipOfferAt(5, segs)).toEqual({ kind: "recap", label: "Skip recap", to: 25 });
    expect(skipOfferAt(5, { ...NO_SEGMENTS, recap: { start: 0, end: 95.2 } })).toEqual({ kind: "recap", label: "Skip recap", to: 95.2 });
  });
  it("offers nothing between them, outside them, or in their last second", () => {
    expect(skipOfferAt(24.5, segs)).toBeNull();
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
  it("falls back to the last 30 s of the file when no credits are marked (Clone High E4)", () => {
    expect(inCredits(1259, NO_SEGMENTS, 1290.5)).toBe(false);
    expect(inCredits(1261, NO_SEGMENTS, 1290.5)).toBe(true);
    expect(inCredits(100, NO_SEGMENTS, 120)).toBe(false);
    // A marked span wins over the fallback.
    expect(inCredits(1270, { ...NO_SEGMENTS, credits: { start: 1280, end: 1290 } }, 1290.5)).toBe(false);
  });
});

describe("startPoint", () => {
  const segs = { ...NO_SEGMENTS, credits: { start: 1260, end: 1320 } };
  it("keeps a spot partway through", () => {
    expect(startPoint(400, 1320, segs)).toBe(400);
  });
  it("starts a finished episode over", () => {
    expect(startPoint(1270, 1320, segs)).toBe(0);
    expect(startPoint(1200, 1320, NO_SEGMENTS)).toBe(0);
    expect(startPoint(0, 1320, segs)).toBe(0);
  });
});

describe("shouldAskStillWatching", () => {
  it("asks after three episodes nobody touched", () => {
    expect(shouldAskStillWatching(2)).toBe(false);
    expect(shouldAskStillWatching(3)).toBe(true);
  });
});

describe("isFinished", () => {
  const segs = { ...NO_SEGMENTS, credits: { start: 1260, end: 1320 } };
  it("is finished from the credits' start, or past 90% without credits", () => {
    expect(isFinished(1259, 1320, segs)).toBe(false);
    expect(isFinished(1260, 1320, segs)).toBe(true);
    expect(isFinished(1187, 1320, NO_SEGMENTS)).toBe(false);
    expect(isFinished(1190, 1320, NO_SEGMENTS)).toBe(true);
  });
  it("is never finished at 0 or with nothing to measure against", () => {
    expect(isFinished(0, 1320, segs)).toBe(false);
    expect(isFinished(1300, null, NO_SEGMENTS)).toBe(false);
  });
});
