import { describe, it, expect } from "vitest";
import {
  GUIDE_SLOT_MS,
  guideKey,
  guideSlots,
  guideWindow,
  isAiring,
  layoutGuideRow,
  nowOffset,
  programsForChannel,
  slotStart,
  trimGuidePrograms,
  type GuideProgram,
} from "../liveGuideGrid";

const at = (iso: string) => Date.parse(iso);
const prog = (title: string, start: string, end: string): GuideProgram => ({
  title,
  subtitle: null,
  startUtc: start,
  endUtc: end,
});

// 20:00Z to 23:00Z, three hours, pinned to UTC.
const WIN = guideWindow(at("2026-10-16T20:10:00Z"), 3, 0);

describe("slotStart / guideWindow", () => {
  it("floors to the half-hour in UTC", () => {
    expect(slotStart(at("2026-10-16T20:10:00Z"), 0)).toBe(at("2026-10-16T20:00:00Z"));
    expect(slotStart(at("2026-10-16T20:30:00Z"), 0)).toBe(at("2026-10-16T20:30:00Z"));
    expect(slotStart(at("2026-10-16T20:59:59Z"), 0)).toBe(at("2026-10-16T20:30:00Z"));
  });

  it("floors to the viewer's local half-hour, not UTC's, in a :45-offset zone", () => {
    // Nepal is UTC+5:45 (getTimezoneOffset() = -345). 14:40Z is 20:25 local,
    // whose half-hour is 20:00 local = 14:15Z; the UTC floor would be 14:30Z.
    expect(slotStart(at("2026-10-16T14:40:00Z"), -345)).toBe(at("2026-10-16T14:15:00Z"));
    // US Eastern (offset 240) agrees with UTC, as every whole/half-hour zone does.
    expect(slotStart(at("2026-10-16T20:35:00Z"), 240)).toBe(at("2026-10-16T20:30:00Z"));
  });

  it("spans the requested hours as half-hour columns", () => {
    expect(WIN).toEqual({ startMs: at("2026-10-16T20:00:00Z"), endMs: at("2026-10-16T23:00:00Z") });
    const slots = guideSlots(WIN);
    expect(slots).toHaveLength(6);
    expect(slots[1] - slots[0]).toBe(GUIDE_SLOT_MS);
  });
});

describe("nowOffset / isAiring", () => {
  it("places the now line as a fraction of the window", () => {
    expect(nowOffset(WIN, at("2026-10-16T20:00:00Z"))).toBe(0);
    expect(nowOffset(WIN, at("2026-10-16T21:30:00Z"))).toBe(0.5);
    expect(nowOffset(WIN, at("2026-10-16T23:30:00Z"))).toBeNull();
  });

  it("treats the end instant as no longer airing", () => {
    const b = { startMs: at("2026-10-16T20:00:00Z"), endMs: at("2026-10-16T20:30:00Z") };
    expect(isAiring(b, at("2026-10-16T20:00:00Z"))).toBe(true);
    expect(isAiring(b, at("2026-10-16T20:30:00Z"))).toBe(false);
  });
});

describe("layoutGuideRow", () => {
  it("is a single full-width gap when there is no guide data", () => {
    expect(layoutGuideRow([], WIN)).toEqual([
      { kind: "gap", startMs: WIN.startMs, endMs: WIN.endMs, offset: 0, width: 1 },
    ]);
  });

  it("sizes blocks by duration and fills the holes between them", () => {
    const blocks = layoutGuideRow(
      [
        prog("B", "2026-10-16T21:00:00Z", "2026-10-16T22:00:00Z"),
        prog("A", "2026-10-16T20:00:00Z", "2026-10-16T20:30:00Z"),
      ],
      WIN
    );
    expect(blocks.map((b) => [b.kind, b.offset, b.width])).toEqual([
      ["program", 0, 1 / 6],
      ["gap", 1 / 6, 1 / 6],
      ["program", 2 / 6, 2 / 6],
      ["gap", 4 / 6, 2 / 6],
    ]);
    expect(blocks[0].kind === "program" && blocks[0].program.title).toBe("A");
  });

  it("clips a programme already under way to the left edge, and flags it", () => {
    const [b] = layoutGuideRow([prog("Game", "2026-10-16T19:00:00Z", "2026-10-16T20:45:00Z")], WIN);
    expect(b).toMatchObject({ kind: "program", offset: 0, width: 0.75 / 3, clippedStart: true });
  });

  it("clips a programme running past the window to the right edge", () => {
    const blocks = layoutGuideRow([prog("Movie", "2026-10-16T22:00:00Z", "2026-10-17T01:00:00Z")], WIN);
    const last = blocks[blocks.length - 1];
    expect(last).toMatchObject({ kind: "program", offset: 2 / 3, width: 1 / 3, clippedStart: false });
  });

  it("drops listings entirely outside the window and unparseable ones", () => {
    const blocks = layoutGuideRow(
      [
        prog("Morning", "2026-10-16T08:00:00Z", "2026-10-16T09:00:00Z"),
        prog("Tomorrow", "2026-10-17T08:00:00Z", "2026-10-17T09:00:00Z"),
        prog("Broken", "not a date", "2026-10-16T21:00:00Z"),
        prog("Zero", "2026-10-16T21:00:00Z", "2026-10-16T21:00:00Z"),
      ],
      WIN
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("gap");
  });

  it("starts an overlapping programme where the previous one ends", () => {
    const blocks = layoutGuideRow(
      [
        prog("A", "2026-10-16T20:00:00Z", "2026-10-16T21:00:00Z"),
        prog("B", "2026-10-16T20:30:00Z", "2026-10-16T21:30:00Z"),
      ],
      WIN
    );
    expect(blocks[0]).toMatchObject({ kind: "program", endMs: at("2026-10-16T21:00:00Z") });
    expect(blocks[1]).toMatchObject({
      kind: "program",
      startMs: at("2026-10-16T21:00:00Z"),
      endMs: at("2026-10-16T21:30:00Z"),
    });
  });

  it("absorbs a one-minute gap between listings instead of drawing a sliver", () => {
    const blocks = layoutGuideRow(
      [
        prog("A", "2026-10-16T20:00:00Z", "2026-10-16T20:29:00Z"),
        prog("B", "2026-10-16T20:30:00Z", "2026-10-16T23:00:00Z"),
      ],
      WIN
    );
    expect(blocks.map((b) => b.kind)).toEqual(["program", "program"]);
    expect(blocks[1].startMs).toBe(at("2026-10-16T20:29:00Z"));
    // Still spans the whole window with no overlap.
    expect(blocks[0].width + blocks[1].width).toBeCloseTo(1);
  });
});

describe("programsForChannel", () => {
  const now = {
    id: "1",
    name: "Jellyfin Now",
    episodeTitle: "Ep",
    overview: null,
    startUtc: "2026-10-16T20:00:00Z",
    endUtc: "2026-10-16T21:00:00Z",
    isLive: false,
    isNews: false,
    isSports: false,
  };

  it("prefers the EPG map, matched on a normalised name", () => {
    const epg = { [guideKey("FOX 31  Rochester")]: [prog("EPG", "2026-10-16T20:00:00Z", "2026-10-16T21:00:00Z")] };
    expect(programsForChannel({ name: "fox 31 rochester", now, next: null }, epg)[0].title).toBe("EPG");
  });

  it("falls back to Jellyfin's now/next", () => {
    expect(programsForChannel({ name: "X", now, next: null }, {})).toEqual([
      { title: "Jellyfin Now", subtitle: "Ep", startUtc: now.startUtc, endUtc: now.endUtc },
    ]);
    expect(programsForChannel({ name: "X", now: null, next: null }, {})).toEqual([]);
  });
});

describe("trimGuidePrograms", () => {
  it("keeps only listings that could be on screen, keyed by guideKey", () => {
    const nowMs = at("2026-10-16T20:10:00Z");
    const out = trimGuidePrograms(
      new Map([
        [
          "CBS 8",
          [
            { title: "Old", description: "", startUtc: "2026-10-16T10:00:00Z", endUtc: "2026-10-16T11:00:00Z" },
            { title: "Now", description: "  News   at eight ", startUtc: "2026-10-16T20:00:00Z", endUtc: "2026-10-16T21:00:00Z" },
            { title: "Far", description: "", startUtc: "2026-10-17T12:00:00Z", endUtc: "2026-10-17T13:00:00Z" },
          ],
        ],
        ["Empty", [{ title: "Old", description: "", startUtc: "2026-10-16T01:00:00Z", endUtc: "2026-10-16T02:00:00Z" }]],
      ]),
      nowMs,
      6
    );
    expect(Object.keys(out)).toEqual(["cbs 8"]);
    expect(out["cbs 8"]).toEqual([
      { title: "Now", subtitle: "News at eight", startUtc: "2026-10-16T20:00:00Z", endUtc: "2026-10-16T21:00:00Z" },
    ]);
  });
});
