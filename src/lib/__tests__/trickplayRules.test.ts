import { describe, expect, it } from "vitest";
import { pickTrickplay, trickplayCell, type TrickplayManifest } from "@/lib/trickplayRules";

const m: TrickplayManifest = { width: 320, height: 180, tileWidth: 10, tileHeight: 10, thumbnailCount: 250, interval: 10000 };

describe("trickplayCell", () => {
  it("finds the frame's sheet and place", () => {
    expect(trickplayCell(0, m)).toEqual({ sheet: 0, x: 0, y: 0 });
    expect(trickplayCell(125, m)).toEqual({ sheet: 0, x: 2 * 320, y: 1 * 180 }); // frame 12
    expect(trickplayCell(1000, m)).toEqual({ sheet: 1, x: 0, y: 0 }); // frame 100
  });

  it("clamps past the end and before the start", () => {
    expect(trickplayCell(99999, m)).toEqual({ sheet: 2, x: 9 * 320, y: 4 * 180 }); // frame 249
    expect(trickplayCell(-5, m)).toEqual({ sheet: 0, x: 0, y: 0 });
  });

  it("gives nothing for an empty manifest", () => {
    expect(trickplayCell(10, { ...m, thumbnailCount: 0 })).toBeNull();
  });
});

describe("pickTrickplay", () => {
  const info = (w: number) => ({ Width: w, Height: (w * 9) / 16, TileWidth: 10, TileHeight: 10, ThumbnailCount: 50, Interval: 10000 });

  it("takes the smallest width that is big enough", () => {
    expect(pickTrickplay({ src1: { "320": info(320), "640": info(640) } })).toMatchObject({ mediaSourceId: "src1", width: 320 });
  });

  it("falls back to the largest when none is big enough", () => {
    expect(pickTrickplay({ s: { "120": info(120), "140": info(140) } })).toMatchObject({ width: 140 });
  });

  it("is null when the title has none yet", () => {
    expect(pickTrickplay({})).toBeNull();
    expect(pickTrickplay(undefined)).toBeNull();
  });
});
