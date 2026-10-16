import { describe, it, expect } from "vitest";
import { pickLiveNow, UP_NEXT_COUNT, type NowFixture } from "../liveNowRules";

const NOW = Date.parse("2026-10-16T23:00:00Z");

function fixture(over: Partial<NowFixture> & { id: string }): NowFixture {
  return {
    league: "NHL",
    startUtc: "2026-10-16T23:30:00Z",
    detail: "7:30 PM EDT",
    state: "pre",
    name: `Game ${over.id}`,
    ...over,
  };
}

describe("pickLiveNow", () => {
  it("leads with every game in progress, in ESPN's order", () => {
    const pick = pickLiveNow(
      [
        fixture({ id: "a", state: "post", detail: "Final" }),
        fixture({ id: "b", state: "in", detail: "2nd Period" }),
        fixture({ id: "c", state: "pre" }),
        fixture({ id: "d", state: "in", detail: "3rd Qtr" }),
      ],
      { nowMs: NOW }
    );
    expect(pick.kind).toBe("live");
    expect(pick.fixtures.map((f) => f.id)).toEqual(["b", "d"]);
  });

  it("puts the games the lineup already carries first, without dropping the rest", () => {
    const pick = pickLiveNow(
      [fixture({ id: "b", state: "in" }), fixture({ id: "d", state: "in" })],
      { nowMs: NOW, watchableIds: new Set(["d"]) }
    );
    expect(pick.fixtures.map((f) => f.id)).toEqual(["d", "b"]);
  });

  it("falls back to the next few kickoffs when nothing is on", () => {
    const pick = pickLiveNow(
      [
        fixture({ id: "late", startUtc: "2026-10-17T02:00:00Z" }),
        fixture({ id: "done", state: "post", startUtc: "2026-10-16T17:00:00Z" }),
        fixture({ id: "soon", startUtc: "2026-10-16T23:05:00Z" }),
        fixture({ id: "mid", startUtc: "2026-10-17T00:00:00Z" }),
        fixture({ id: "latest", startUtc: "2026-10-17T03:00:00Z" }),
      ],
      { nowMs: NOW }
    );
    expect(pick.kind).toBe("upnext");
    expect(pick.fixtures).toHaveLength(UP_NEXT_COUNT);
    expect(pick.fixtures.map((f) => f.id)).toEqual(["soon", "mid", "late"]);
  });

  it("leaves out upcoming games with no start time and ones already past their kickoff", () => {
    const pick = pickLiveNow(
      [
        fixture({ id: "nokick", startUtc: null }),
        // ESPN still says "pre" for a minute or two after kickoff; it is
        // not "next" any more either way.
        fixture({ id: "stale", startUtc: "2026-10-16T22:00:00Z" }),
        fixture({ id: "ok", startUtc: "2026-10-16T23:30:00Z" }),
      ],
      { nowMs: NOW }
    );
    expect(pick.kind).toBe("upnext");
    expect(pick.fixtures.map((f) => f.id)).toEqual(["ok"]);
  });

  it("answers an empty Up next for an empty slate", () => {
    expect(pickLiveNow([], { nowMs: NOW })).toEqual({ kind: "upnext", fixtures: [] });
  });
});
