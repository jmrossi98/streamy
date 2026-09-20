import { describe, expect, it } from "vitest";
import {
  isAtLiveEdge,
  liveSeekTarget,
  looksLikeEventFeed,
  looksLikeNetworkFeed,
  findCandidateChannels,
  findChannelForFixture,
  liveTrackPercent,
  secondsBehindLive,
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

describe("liveSeekTarget", () => {
  const CUSHION = 8;

  it("lands a cushion short of the edge, not on it", () => {
    // Landing exactly on the edge leaves nothing buffered ahead, which is an
    // immediate stall.
    expect(liveSeekTarget(0, 0, 100, CUSHION)).toBe(92);
  });

  it("never rewinds when recovering from a stall", () => {
    // The loop bug: at live the playhead is already ~edge-cushion, so an
    // unconditional seek to that target moves backwards by the cushion. Repeat
    // per stall and the same seconds replay forever.
    expect(liveSeekTarget(92, 0, 100, CUSHION, { forwardOnly: true })).toBeNull();
    expect(liveSeekTarget(95, 0, 100, CUSHION, { forwardOnly: true })).toBeNull();
  });

  it("still moves forward when genuinely behind", () => {
    expect(liveSeekTarget(40, 0, 100, CUSHION, { forwardOnly: true })).toBe(92);
  });

  it("allows a deliberate jump to live from far behind", () => {
    // Without forwardOnly, direction is not restricted -- that is the button.
    expect(liveSeekTarget(10, 0, 100, CUSHION)).toBe(92);
  });

  it("never seeks before the window starts", () => {
    // A window shorter than the cushion is normal in the first seconds of a
    // tune; clamping stops a seek to a negative time.
    expect(liveSeekTarget(0, 50, 54, CUSHION)).toBe(50);
  });

  it("returns null rather than NaN before a window exists", () => {
    expect(liveSeekTarget(0, 0, Number.NaN, CUSHION)).toBeNull();
    expect(liveSeekTarget(0, Number.NaN, 100, CUSHION)).toBeNull();
  });
});

describe("looksLikeEventFeed", () => {
  it("flags the fixture-style names that turned out to be dead", () => {
    // Both real: promoted here, then reported as "won't stream".
    expect(looksLikeEventFeed("NFL CBS BILLS GIANTS JETS NEW YORK NY")).toBe(false);
    expect(looksLikeEventFeed("UEFA | 09 - Arsenal vs Vilareal 6:00pm")).toBe(true);
    expect(looksLikeEventFeed("UEFA | 32 - ARSENAL - ATHLETIC CLUB BILBAO | Sat 09 Aug 15:45")).toBe(true);
    expect(looksLikeEventFeed("LIVE EVENT 01 - 5pm Prelims UFC 331")).toBe(true);
    expect(looksLikeEventFeed("PPV: EVENT UFC 1080P")).toBe(true);
    expect(looksLikeEventFeed("US (ESPN+ 006) | Soccer: Fri_ 9/18 _ LALIGA Highlight Show")).toBe(true);
  });

  it("leaves always-on networks alone", () => {
    // These are the ones worth promoting, and were measured live.
    expect(looksLikeEventFeed("NBA TV HD")).toBe(false);
    expect(looksLikeEventFeed("SP - NHL NETWORK HD")).toBe(false);
    expect(looksLikeEventFeed("ESPN2")).toBe(false);
    expect(looksLikeEventFeed("CBS News")).toBe(false);
  });
});

describe("looksLikeNetworkFeed", () => {
  it("recognises the always-on networks worth promoting", () => {
    // All measured live against the provider.
    expect(looksLikeNetworkFeed("NBA TV HD")).toBe(true);
    expect(looksLikeNetworkFeed("SP - NHL NETWORK HD")).toBe(true);
    expect(looksLikeNetworkFeed("USA - ESPN2 HD")).toBe(true);
    expect(looksLikeNetworkFeed("SP - BEIN SPORTS LA LIGA HD")).toBe(true);
    expect(looksLikeNetworkFeed("NCAAF 09: BIG TEN NETWORK")).toBe(true);
  });

  it("rejects fixtures even when they name the broadcaster", () => {
    // The case the fixture heuristic alone misses. "CBS" is in the allowlist,
    // so without the event check first this would qualify as a network -- and
    // it is precisely the dead channel that started all of this.
    expect(looksLikeNetworkFeed("NFL CBS BILLS GIANTS JETS NEW YORK NY")).toBe(false);
    expect(looksLikeNetworkFeed("UEFA | 09 - Arsenal vs Vilareal 6:00pm")).toBe(false);
  });

  it("rejects a league name on its own", () => {
    // "NHL" alone is a fixture feed's prefix, not a network.
    expect(looksLikeNetworkFeed("NHL BUFFALO SABRES")).toBe(false);
    expect(looksLikeNetworkFeed("NBA 07 :")).toBe(false);
  });
});

describe("findChannelForFixture", () => {
  const channels = [
    { id: "1", name: "NHL BUFFALO SABRES" },
    { id: "2", name: "NBA TV HD" },
    { id: "3", name: "SP - NHL NETWORK HD" },
    { id: "4", name: "USA - FOX 47 ROCHESTER MN (KXLT)" },
  ];

  it("matches a fixture channel by nickname", () => {
    const fixture = { awayTeam: "Toronto Maple Leafs", homeTeam: "Buffalo Sabres" };
    expect(findChannelForFixture(fixture, channels)?.id).toBe("1");
  });

  it("tries the away team, then the home team", () => {
    // Only the home side matches here; the function must not stop at the
    // first (unmatched) nickname.
    const fixture = { awayTeam: "Dallas Stars", homeTeam: "Buffalo Sabres" };
    expect(findChannelForFixture(fixture, channels)?.id).toBe("1");
  });

  it("returns null rather than a wrong guess", () => {
    const fixture = { awayTeam: "Los Angeles Lakers", homeTeam: "Golden State Warriors" };
    expect(findChannelForFixture(fixture, channels)).toBeNull();
  });

  it("excludes short and common nicknames", () => {
    // "City" and "United" alone would match almost anything -- worth being
    // wrong in the safe direction (no link) rather than the flashy one.
    const fixture = { awayTeam: "Manchester City", homeTeam: "Leeds United" };
    expect(findChannelForFixture(fixture, channels)).toBeNull();
  });

  it("handles a fixture with no two sides", () => {
    // F1, UFC: ESPN gives no home/away split for these.
    const fixture = { awayTeam: null, homeTeam: null };
    expect(findChannelForFixture(fixture, channels)).toBeNull();
  });
});

describe("findCandidateChannels", () => {
  const channels = [
    { id: "1", name: "NHL BUFFALO SABRES" },
    { id: "2", name: "NBA TV HD" },
    { id: "3", name: "SP - NHL NETWORK HD" },
    { id: "4", name: "USA - ESPN2 HD" },
    { id: "5", name: "USA - FOX 47 ROCHESTER MN (KXLT)" },
    { id: "6", name: "ABC News AU" },
  ];

  it("lists networks tagged for the fixture's league", () => {
    const ids = findCandidateChannels({ league: "NHL" }, channels).map((c) => c.id);
    expect(ids).toContain("3"); // NHL Network
    expect(ids).toContain("4"); // ESPN
  });

  it("excludes fixture feeds and event-named channels", () => {
    // "NHL BUFFALO SABRES" matches nothing in NETWORK_BRANDS at all (it isn't
    // a network name), so this also guards against the fixture heuristic
    // somehow leaking through.
    const ids = findCandidateChannels({ league: "NHL" }, channels).map((c) => c.id);
    expect(ids).not.toContain("1");
  });

  it("excludes a network with no tie to the fixture's league", () => {
    // NBA TV is a real network, just not one that carries NHL.
    const ids = findCandidateChannels({ league: "NHL" }, channels).map((c) => c.id);
    expect(ids).not.toContain("2");
  });

  it("never lists a plain-language channel a brand regex happens to hit", () => {
    // "ABC News AU" matching nothing here is the point being guarded --
    // there is no bare "ABC" pattern precisely because this channel exists.
    const ids = findCandidateChannels({ league: "NBA" }, channels).map((c) => c.id);
    expect(ids).not.toContain("6");
  });

  it("ranks a dedicated single-sport network ahead of a generalist", () => {
    const ids = findCandidateChannels({ league: "NHL" }, channels).map((c) => c.id);
    expect(ids.indexOf("3")).toBeLessThan(ids.indexOf("4"));
  });

  it("returns nothing for a league no lineup channel carries", () => {
    expect(findCandidateChannels({ league: "Formula 1" }, channels)).toEqual([]);
  });
});
