import { describe, expect, it } from "vitest";
import {
  LIVE_SNAP_SECONDS,
  isAtLiveEdge,
  liveTrackPercent,
  secondsBehindLive,
  shouldSnapToLive,
} from "@/lib/liveTimeline";

describe("liveTrackPercent", () => {
  it("maps a position across the seekable window", () => {
    // A 120s window running from 1000 to 1120.
    expect(liveTrackPercent(1000, 1000, 1120)).toBe(0);
    expect(liveTrackPercent(1060, 1000, 1120)).toBe(50);
    expect(liveTrackPercent(1120, 1000, 1120)).toBe(100);
  });

  it("does not assume the window starts at zero", () => {
    // The whole reason this is not currentTime/duration: a live window's
    // start is wherever the oldest retained segment happens to be, and it
    // climbs for as long as the stream runs.
    expect(liveTrackPercent(3600, 3600, 3660)).toBe(0);
    expect(liveTrackPercent(3630, 3600, 3660)).toBe(50);
  });

  it("clamps a playhead that has drifted outside the window", () => {
    // Legitimate: the window is re-read on a timer while playback keeps
    // moving between reads, so currentTime can sit slightly either side.
    expect(liveTrackPercent(999, 1000, 1120)).toBe(0);
    expect(liveTrackPercent(1121, 1000, 1120)).toBe(100);
  });

  it("returns 0 rather than NaN before a window exists", () => {
    // The first frames arrive before `seekable` reports anything, and a NaN
    // here becomes width:"NaN%" -- a bar that renders at full width.
    expect(liveTrackPercent(0, 0, 0)).toBe(0);
    expect(liveTrackPercent(10, 100, 100)).toBe(0);
    expect(liveTrackPercent(10, 0, Infinity)).toBe(0);
  });
});

describe("shouldSnapToLive", () => {
  it("treats a drag to the end as asking for live", () => {
    expect(shouldSnapToLive(1120, 1120)).toBe(true);
  });

  it("snaps from just short of the edge", () => {
    // The edge advances while the pointer moves, so an exact landing is not
    // something a person can do. Without the tolerance, dragging fully right
    // leaves you a second behind and stuck there.
    expect(shouldSnapToLive(1120 - (LIVE_SNAP_SECONDS - 1), 1120)).toBe(true);
  });

  it("leaves a deliberate seek back alone", () => {
    expect(shouldSnapToLive(1060, 1120)).toBe(false);
    expect(shouldSnapToLive(1120 - (LIVE_SNAP_SECONDS + 1), 1120)).toBe(false);
  });

  it("is safe before an edge is known", () => {
    expect(shouldSnapToLive(NaN, 1120)).toBe(false);
    expect(shouldSnapToLive(10, NaN)).toBe(false);
  });
});

describe("secondsBehindLive", () => {
  it("reports the gap to the edge", () => {
    expect(secondsBehindLive(1060, 1120)).toBe(60);
  });

  it("never reports a negative", () => {
    // Playback can read past the last-sampled edge for the same reason the
    // clamp above exists; "-0:-2 behind" is not worth rendering.
    expect(secondsBehindLive(1121, 1120)).toBe(0);
  });
});

describe("isAtLiveEdge", () => {
  it("allows the few seconds every HLS stream sits back by design", () => {
    // An exact comparison would mean the badge never says Live and the
    // "go live" button never switches off.
    expect(isAtLiveEdge(1115, 1120)).toBe(true);
    expect(isAtLiveEdge(1105, 1120)).toBe(true);
  });

  it("calls a real lag behind", () => {
    expect(isAtLiveEdge(1060, 1120)).toBe(false);
  });
});
