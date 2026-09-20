import { describe, expect, it } from "vitest";
import {
  isAtLiveEdge,
  liveSeekTarget,
  looksLikeEventFeed,
  looksLikeNetworkFeed,
  findCandidateChannels,
  findChannelForFixture,
  findEpgConfirmedChannel,
  findEpgConfirmedChannelNames,
  matchFixturesToEpgProgrammes,
  resolveChannelForFixture,
  liveTrackPercent,
  secondsBehindLive,
  type ChannelProgramme,
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
    // ESPN+'s numbered per-game feeds: no "vs" or weekday, just an ISO
    // kickoff timestamp -- the shape that slipped through as "ESPN" networks.
    expect(looksLikeEventFeed("US (ESPN+ 322) | NHL: Jets Broadcast (2026-09-22 20:00:05)")).toBe(true);
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
    // ESPN+'s numbered per-game feeds: the ESPN brand match alone used to be
    // enough to qualify these as a "network", one per NHL/NBA/MLB game on the
    // slate -- the exact clutter "Networks only" exists to filter out.
    expect(
      looksLikeNetworkFeed("US (ESPN+ 322) | NHL: Jets Broadcast (2026-09-22 20:00:05)")
    ).toBe(false);
  });

  it("rejects a league name on its own", () => {
    // "NHL" alone is a fixture feed's prefix, not a network.
    expect(looksLikeNetworkFeed("NHL BUFFALO SABRES")).toBe(false);
    expect(looksLikeNetworkFeed("NBA 07 :")).toBe(false);
  });

  it("recognises a local affiliate by its FCC call sign", () => {
    // Four letters, W or K, in parens at the end -- real stations, not a
    // guess the way a brand-name regex is.
    expect(looksLikeNetworkFeed("USA - CBS 13 BALTIMORE MD (WJZ)")).toBe(true);
    expect(looksLikeNetworkFeed("USA - FOX 47 ROCHESTER MN (KXLT)")).toBe(true);
  });

  it("recognises general-purpose networks, not just sports ones", () => {
    // The point of the expansion: "Networks only" is not a sports-only filter.
    expect(looksLikeNetworkFeed("USA - CNN HD")).toBe(true);
    expect(looksLikeNetworkFeed("USA - DISCOVERY CHANNEL HD")).toBe(true);
    expect(looksLikeNetworkFeed("USA - HBO EAST HD")).toBe(true);
  });

  it("recognises MLS and Premier League's actual US rightsholders", () => {
    // MLS: Apple-exclusive since 2023 -- "MLS Season Pass" is the specific
    // service, not the generic "Apple TV" brand (which would false-positive
    // on every unrelated Apple TV+ channel).
    expect(looksLikeNetworkFeed("US - MLS Season Pass HD")).toBe(true);
    // Premier League: Peacock picked up the games that used to air on the
    // now-defunct NBCSN. A local NBC affiliate is still recognised, but via
    // its own call sign (see "recognises a local affiliate..." above) rather
    // than a bare "NBC" brand match -- see findCandidateChannels' market
    // tests for why that stays narrow.
    expect(looksLikeNetworkFeed("USA - Peacock HD")).toBe(true);
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

  describe("market matching", () => {
    const localChannels = [
      { id: "10", name: "USA - CBS 13 BALTIMORE MD (WJZ)" },
      { id: "11", name: "USA - FOX 47 ROCHESTER MN (KXLT)" },
      { id: "12", name: "USA - NBC 10 BUFFALO NY (WGRZ)" },
    ];

    it("lists a market's local affiliate for a home team's game", () => {
      // The exact case reported live: WJZ carries no team name and "CBS"
      // alone is too broad to mean anything, but it is Baltimore's own
      // station -- worth a look for a Baltimore team's game specifically.
      const fixture = { league: "NFL", awayTeam: "Pittsburgh Steelers", homeTeam: "Baltimore Ravens" };
      const ids = findCandidateChannels(fixture, localChannels).map((c) => c.id);
      expect(ids).toContain("10");
    });

    it("does not list a market with no connection to either team", () => {
      const fixture = { league: "NFL", awayTeam: "Pittsburgh Steelers", homeTeam: "Baltimore Ravens" };
      const ids = findCandidateChannels(fixture, localChannels).map((c) => c.id);
      expect(ids).not.toContain("11");
      expect(ids).not.toContain("12");
    });

    it("matches a multi-word market in full", () => {
      const fixture = { league: "NFL", awayTeam: "Kansas City Chiefs", homeTeam: "Denver Broncos" };
      const withKC = [...localChannels, { id: "13", name: "USA - FOX 4 KANSAS CITY MO (WDAF)" }];
      const ids = findCandidateChannels(fixture, withKC).map((c) => c.id);
      expect(ids).toContain("13");
    });

    it("never lists the same channel twice when it matches both signals", () => {
      // ESPN both carries the league and, incidentally, could share a word
      // with a city -- the point is de-duplication, not this specific case.
      const fixture = { league: "NHL", awayTeam: "Buffalo Sabres", homeTeam: "Toronto Maple Leafs" };
      const ids = findCandidateChannels(fixture, channels).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("does not require team names -- a league-only fixture still works", () => {
      // findCandidateChannels must keep working for callers (like the old
      // signature) that never pass awayTeam/homeTeam at all.
      const ids = findCandidateChannels({ league: "NHL" }, channels).map((c) => c.id);
      expect(ids).toContain("3");
    });
  });
});

describe("findEpgConfirmedChannelNames", () => {
  const programme = (over: Partial<ChannelProgramme> = {}): ChannelProgramme => ({
    title: "NFL Football",
    description: "The Minnesota Vikings host the Chicago Bears.",
    startUtc: "2026-09-21T17:00:00Z",
    endUtc: "2026-09-21T20:00:00Z",
    ...over,
  });
  const now = "2026-09-21T18:00:00Z"; // Inside the programme's window.
  const fixture = { awayTeam: "Minnesota Vikings", homeTeam: "Chicago Bears" };

  it("confirms a channel whose current programme names both teams", () => {
    const programs = new Map([["NFL - NFL NETWORK HD", [programme()]]]);
    expect(findEpgConfirmedChannelNames(fixture, programs, now)).toEqual(["NFL - NFL NETWORK HD"]);
  });

  it("does not confirm a channel naming only one side", () => {
    // A highlight show mentioning one team is not the same claim as "this is
    // that game, live" -- both teams have to appear.
    const programs = new Map([
      ["NFL - NFL NETWORK HD", [programme({ description: "Vikings news and analysis." })]],
    ]);
    expect(findEpgConfirmedChannelNames(fixture, programs, now)).toEqual([]);
  });

  it("does not confirm a channel whose matching programme already ended", () => {
    const programs = new Map([["NFL - NFL NETWORK HD", [programme()]]]);
    const later = "2026-09-21T21:00:00Z";
    expect(findEpgConfirmedChannelNames(fixture, programs, later)).toEqual([]);
  });

  it("does not confirm a different game naming different teams", () => {
    const programs = new Map([
      [
        "NFL - NFL NETWORK HD",
        [programme({ description: "The Kansas City Chiefs host the Denver Broncos." })],
      ],
    ]);
    expect(findEpgConfirmedChannelNames(fixture, programs, now)).toEqual([]);
  });

  it("falls back to a single side for a fixture with no two teams", () => {
    // F1, UFC: there is nothing stricter to ask of these than one match.
    const programs = new Map([
      ["SP - UFC NETWORK HD", [programme({ description: "Live coverage of Jon Jones tonight." })]],
    ]);
    const oneSided = { awayTeam: null, homeTeam: "Jon Jones" };
    expect(findEpgConfirmedChannelNames(oneSided, programs, now)).toEqual(["SP - UFC NETWORK HD"]);
  });

  it("returns nothing for a fixture with no team names at all", () => {
    const programs = new Map([["NFL - NFL NETWORK HD", [programme()]]]);
    expect(findEpgConfirmedChannelNames({ awayTeam: null, homeTeam: null }, programs, now)).toEqual([]);
  });

  it("confirms more than one channel when more than one airs the same game", () => {
    const programs = new Map([
      ["NFL - NFL NETWORK HD", [programme()]],
      ["USA - CBS 13 BALTIMORE MD (WJZ)", [programme()]],
    ]);
    expect(findEpgConfirmedChannelNames(fixture, programs, now).sort()).toEqual(
      ["NFL - NFL NETWORK HD", "USA - CBS 13 BALTIMORE MD (WJZ)"].sort()
    );
  });
});

describe("matchFixturesToEpgProgrammes", () => {
  const programme: ChannelProgramme = {
    title: "NFL Football",
    description: "The Minnesota Vikings host the Chicago Bears.",
    startUtc: "2026-09-21T17:00:00Z",
    endUtc: "2026-09-21T20:00:00Z",
  };
  const now = "2026-09-21T18:00:00Z";

  it("keys results by fixture id, one Dispatcharr fetch for the whole schedule", () => {
    const fixtures = [
      { id: "nfl:1", awayTeam: "Minnesota Vikings", homeTeam: "Chicago Bears" },
      { id: "nfl:2", awayTeam: "Dallas Cowboys", homeTeam: "New York Giants" },
    ];
    const programs = new Map([["NFL - NFL NETWORK HD", [programme]]]);
    const result = matchFixturesToEpgProgrammes(fixtures, programs, now);
    expect(result.get("nfl:1")).toEqual(["NFL - NFL NETWORK HD"]);
    expect(result.has("nfl:2")).toBe(false);
  });
});

describe("findEpgConfirmedChannel / resolveChannelForFixture", () => {
  const channels = [
    { id: "1", name: "NHL BUFFALO SABRES" },
    { id: "2", name: "NFL - NFL NETWORK HD" },
  ];

  it("finds the channel object named in a confirmed-names list", () => {
    expect(findEpgConfirmedChannel(["NFL - NFL NETWORK HD"], channels)?.id).toBe("2");
  });

  it("returns null when nothing in the confirmed list is in the lineup", () => {
    expect(findEpgConfirmedChannel(["ESPN"], channels)).toBeNull();
  });

  it("resolveChannelForFixture prefers EPG confirmation over a name-based guess", () => {
    // A fixture whose nickname match would resolve to the Sabres channel,
    // but EPG confirms a completely different channel -- the real fact wins.
    const fixture = { awayTeam: "Toronto Maple Leafs", homeTeam: "Buffalo Sabres" };
    const result = resolveChannelForFixture(fixture, channels, ["NFL - NFL NETWORK HD"]);
    expect(result?.id).toBe("2");
  });

  it("resolveChannelForFixture falls back to the name-based guess with no EPG data", () => {
    const fixture = { awayTeam: "Toronto Maple Leafs", homeTeam: "Buffalo Sabres" };
    expect(resolveChannelForFixture(fixture, channels, [])?.id).toBe("1");
  });

  it("resolveChannelForFixture returns null when neither finds anything", () => {
    const fixture = { awayTeam: "Los Angeles Lakers", homeTeam: "Golden State Warriors" };
    expect(resolveChannelForFixture(fixture, channels, [])).toBeNull();
  });
});
