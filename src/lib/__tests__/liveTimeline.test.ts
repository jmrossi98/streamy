import { describe, expect, it } from "vitest";
import {
  isAtLiveEdge,
  networksOnOtherGames,
  liveSeekTarget,
  looksLikeEventFeed,
  looksLikeNetworkFeed,
  looksLikePlaceholder,
  channelCarriesNetwork,
  findCandidateChannels,
  namesBothTeams,
  findEpgElsewhereChannelNames,
  gameReferenceTime,
  findChannelForFixture,
  findEpgConfirmedChannel,
  findEpgConfirmedChannelNames,
  matchFixturesToEpgProgrammes,
  resolveChannelForFixture,
  liveTrackPercent,
  secondsBehindLive,
  contestedLocalNetworks,
  networkConfirmsFixture,
  channelMarketTeam,
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

describe("looksLikePlaceholder", () => {
  it("flags the provider's own padding conventions", () => {
    // The reported case: repeated hashes standing in for a reserved slot.
    expect(looksLikePlaceholder("#####")).toBe(true);
    expect(looksLikePlaceholder("US| ###### ᴴᴰ")).toBe(true);
    expect(looksLikePlaceholder("## 24/7 REALITY ##")).toBe(true);
    expect(looksLikePlaceholder("N/A")).toBe(true);
    expect(looksLikePlaceholder("UK| RESERVED 12")).toBe(true);
    expect(looksLikePlaceholder("coming soon")).toBe(true);
    // Dividers and empties: no letters at all is never a channel name.
    expect(looksLikePlaceholder("--------")).toBe(true);
    expect(looksLikePlaceholder("   ")).toBe(true);
    expect(looksLikePlaceholder("=== 1234 ===")).toBe(true);
  });

  it("leaves real channel names alone, including a lone hash", () => {
    expect(looksLikePlaceholder("SP - NHL NETWORK HD")).toBe(false);
    expect(looksLikePlaceholder("USA - CBS 13 BALTIMORE MD (WJZ)")).toBe(false);
    expect(looksLikePlaceholder("Channel #5")).toBe(false);
    // Non-Latin scripts are still letters -- \p{L}, not [A-Za-z], is what
    // keeps an Arabic or Greek channel name out of the no-letters branch.
    expect(looksLikePlaceholder("قناة الكأس")).toBe(false);
    expect(looksLikePlaceholder("ΕΡΤ1 HD")).toBe(false);
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

  it("recognises the streaming services that hold whole competitions", () => {
    // Paramount+ holds the US Champions League rights outright -- matched on
    // the "+"/"plus", since bare "Paramount" is a studio name on movie
    // channels that carry no sport at all.
    expect(looksLikeNetworkFeed("US| PARAMOUNT+ ᴴᴰ")).toBe(true);
    expect(looksLikeNetworkFeed("US| PARAMOUNT PLUS")).toBe(true);
    expect(looksLikeNetworkFeed("US| PARAMOUNT MOVIE NETWORK")).toBe(false);
    expect(looksLikeNetworkFeed("US| F1 TV PRO")).toBe(true);
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

  it("offers the streamers that actually hold each competition's US rights", () => {
    // The gap these tags close: a Champions League or Formula 1 fixture had
    // no candidate at all, even with the channel sitting in the lineup.
    const streamers = [
      { id: "20", name: "US| PARAMOUNT+ ᴴᴰ" },
      { id: "21", name: "US| PEACOCK ᴴᴰ" },
      { id: "22", name: "USA - ESPN2 HD" },
      { id: "23", name: "SP - TNT HD" },
    ];
    expect(findCandidateChannels({ league: "Champions League" }, streamers).map((c) => c.id)).toContain("20");
    expect(findCandidateChannels({ league: "Premier League" }, streamers).map((c) => c.id)).toContain("21");
    expect(findCandidateChannels({ league: "Formula 1" }, streamers).map((c) => c.id)).toContain("22");
    expect(findCandidateChannels({ league: "La Liga" }, streamers).map((c) => c.id)).toContain("22");
    // TNT carries NHL in the US and was previously tagged NBA-only.
    expect(findCandidateChannels({ league: "NHL" }, streamers).map((c) => c.id)).toContain("23");
  });

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
    // Was "Formula 1" until ESPN picked up its own F1 tag (ESPN holds the US
    // rights) -- which this fixture list has, via ESPN2. MLS is the league
    // none of these six carry: it is an Apple exclusive.
    expect(findCandidateChannels({ league: "MLS" }, channels)).toEqual([]);
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

    it("ranks a team's own local affiliate ahead of a national network", () => {
      // The exact case reported live: a Bills game defaulted to a national
      // feed instead of WKBW, Buffalo's own ABC affiliate, because a market
      // match and a single-league brand match (NFL Network) used to tie at
      // the same specificity -- leaving the winner to catalogue order rather
      // than to which one actually says something about *this* game.
      const withNetwork = [
        { id: "12", name: "USA - NBC 10 BUFFALO NY (WGRZ)" },
        { id: "20", name: "SP - NFL NETWORK HD" },
        { id: "21", name: "USA - ABC 7 BUFFALO NY (WKBW)" },
      ];
      const fixture = { league: "NFL", awayTeam: "Miami Dolphins", homeTeam: "Buffalo Bills" };
      const ids = findCandidateChannels(fixture, withNetwork).map((c) => c.id);
      expect(ids.indexOf("21")).toBeLessThan(ids.indexOf("20"));
      expect(ids.indexOf("12")).toBeLessThan(ids.indexOf("20"));
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

describe("findEpgConfirmedChannelNames: a game bracketed by a team's own shows", () => {
  // 2026-10-17: ESPN listed Sharks at Red Wings on NBC Sports Bay Area (water
  // polo that night); the game was on NBC Sports California, listed only as
  // "Live: NHL Hockey" between the Sharks' own pre- and postgame shows.
  const fixture = {
    league: "NHL",
    awayTeam: "San Jose Sharks",
    homeTeam: "Detroit Red Wings",
    startUtc: "2026-10-17T23:00:00Z",
  };
  const show = (title: string, start: string, end: string): ChannelProgramme => ({
    title,
    description: "",
    startUtc: `2026-10-17T${start}:00Z`,
    endUtc: `2026-10-${end >= start ? "17" : "18"}T${end}:00Z`,
  });
  const nbcsCalifornia = [
    show("Kings Season Preview", "22:00", "22:30"),
    show("Live: Sharks Pregame", "22:30", "23:00"),
    show("Live: NHL Hockey", "23:00", "01:30"),
    show("Live: Sharks Postgame", "01:30", "02:00"),
  ];
  const now = "2026-10-17T23:30:00Z";

  it("confirms the regional network", () => {
    const programs = new Map([["NBC SPORTS CALIFORNIA", nbcsCalifornia]]);
    expect(findEpgConfirmedChannelNames(fixture, programs, now)).toEqual(["NBC SPORTS CALIFORNIA"]);
  });

  it("needs the sport on now, not just a team show nearby", () => {
    const programs = new Map([
      ["NBC Sports Bay Area", [show("Live: Sharks Pregame", "22:30", "23:00"), show("Live: Women's College Water Polo", "23:00", "23:30")]],
    ]);
    expect(findEpgConfirmedChannelNames(fixture, programs, now)).toEqual([]);
  });

  it("needs the team show right next to the game, and for one of these teams", () => {
    const programs = new Map([
      ["NHL NETWORK HD", [show("Top Shelf", "22:00", "22:30"), show("Live: NHL Hockey Central Saturday", "22:30", "23:00"), show("Live: NHL Hockey", "23:00", "02:00")]],
      ["FAR APART", [show("Sharks Classics", "19:00", "20:00"), show("Live: NHL Hockey", "23:00", "02:00")]],
    ]);
    expect(findEpgConfirmedChannelNames(fixture, programs, now)).toEqual([]);
  });

  it("does nothing without the fixture's league", () => {
    const { league: _league, ...noLeague } = fixture;
    const programs = new Map([["NBC SPORTS CALIFORNIA", nbcsCalifornia]]);
    expect(findEpgConfirmedChannelNames(noLeague, programs, now)).toEqual([]);
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

describe("channelCarriesNetwork", () => {
  it("matches the network itself but not its siblings", () => {
    expect(channelCarriesNetwork("US - ESPN HD", "ESPN")).toBe(true);
    expect(channelCarriesNetwork("US - ESPN 2 HD", "ESPN")).toBe(false);
    expect(channelCarriesNetwork("US - ESPNU", "ESPN")).toBe(false);
    expect(channelCarriesNetwork("US - ESPN 2 HD", "ESPN2")).toBe(true);
    expect(channelCarriesNetwork("AMAZON PRIME VIDEO HD", "Prime Video")).toBe(true);
  });

  it("wants an affiliate for an over-the-air network", () => {
    expect(channelCarriesNetwork("USA - FOX 29 BUFFALO NY (WUTV)", "FOX")).toBe(true);
    expect(channelCarriesNetwork("USA - FOX ROCHESTER NY (WUHF)", "FOX")).toBe(true);
    expect(channelCarriesNetwork("US - FOX NEWS", "FOX")).toBe(false);
    expect(channelCarriesNetwork("US - FOX SPORTS 1", "FOX")).toBe(false);
    expect(channelCarriesNetwork("USA - ABC 7 BUFFALO NY (WKBW)", "FOX")).toBe(false);
  });
});

describe("findCandidateChannels with broadcasts", () => {
  it("ranks the carrying network's affiliates above a market-only match", () => {
    // The case reported live 2026-09-27: a Bills game on FOX offered ABC
    // Buffalo first, with the FOX stations below it.
    const lineup = [
      { id: "abc", name: "USA - ABC 7 BUFFALO NY (WKBW)" },
      { id: "foxroc", name: "USA - FOX 31 ROCHESTER NY (WUHF)" },
      { id: "foxbuf", name: "USA - FOX 29 BUFFALO NY (WUTV)" },
      { id: "nfln", name: "SP - NFL NETWORK HD" },
    ];
    const fixture = { league: "NFL", awayTeam: "Los Angeles Chargers", homeTeam: "Buffalo Bills", broadcasts: ["FOX"] };
    expect(findCandidateChannels(fixture, lineup).map((c) => c.id)).toEqual(["foxbuf", "foxroc", "abc", "nfln"]);
  });
});

describe("findCandidateChannels: home market", () => {
  it("puts the household's affiliate of the carrying network ahead of another city's", () => {
    // Patriots at Bills on CBS, 2026-10-04: no Buffalo CBS in the lineup, and
    // Baltimore's was offered ahead of Rochester's.
    const lineup = [
      { id: "balt", name: "USA - CBS 13 BALTIMORE MD (WJZ)" },
      { id: "roc", name: "US: CBS 8 (WROC) ROCHESTER HD" },
      { id: "foxbuf", name: "USA - FOX 29 BUFFALO NY (WUTV)" },
    ];
    const fixture = { league: "NFL", awayTeam: "New England Patriots", homeTeam: "Buffalo Bills", broadcasts: ["CBS"] };
    const ids = findCandidateChannels(fixture, lineup).map((c) => c.id);
    expect(ids.slice(0, 2)).toEqual(["roc", "balt"]);
  });

  it("still puts a team's own market first when it is not the household's", () => {
    const lineup = [
      { id: "roc", name: "US: CBS 8 (WROC) ROCHESTER HD" },
      { id: "balt", name: "USA - CBS 13 BALTIMORE MD (WJZ)" },
    ];
    const fixture = { league: "NFL", awayTeam: "Kansas City Chiefs", homeTeam: "Baltimore Ravens", broadcasts: ["CBS"] };
    expect(findCandidateChannels(fixture, lineup).map((c) => c.id)).toEqual(["balt", "roc"]);
  });
});

describe("guide lookups at game time", () => {
  const prog = (title: string, start: string, end: string, description = "") => ({ title, description, startUtc: start, endUtc: end });
  const guide = new Map([
    ["CBS ROCHESTER", [prog("The NFL Today", "2026-10-04T16:00:00Z", "2026-10-04T17:00:00Z"), prog("Live: NFL Football", "2026-10-04T17:00:00Z", "2026-10-04T20:25:00Z", "Football action from around the National Football League.")]],
    ["CBS ELSEWHERE", [prog("Paid Programming", "2026-10-04T17:00:00Z", "2026-10-04T18:00:00Z")]],
    ["CBS NAMED", [prog("NFL Football", "2026-10-04T17:00:00Z", "2026-10-04T20:25:00Z", "The New England Patriots at the Buffalo Bills.")]],
  ]);
  const fixture = { league: "NFL", awayTeam: "New England Patriots", homeTeam: "Buffalo Bills", startUtc: "2026-10-04T17:00:00Z" };

  it("reads the guide at kickoff for a game that has not started", () => {
    expect(gameReferenceTime("2026-10-04T17:00:00Z", "2026-10-04T16:30:00Z")).toBe(Date.parse("2026-10-04T17:10:00Z"));
    expect(gameReferenceTime("2026-10-04T17:00:00Z", "2026-10-04T18:00:00Z")).toBe(Date.parse("2026-10-04T18:00:00Z"));
    // Before kickoff the pregame show is on, but the game slot names the teams.
    expect(findEpgConfirmedChannelNames(fixture, guide, "2026-10-04T16:30:00Z")).toEqual(["CBS NAMED"]);
  });

  it("flags a station showing something else at game time, and nothing without guide data", () => {
    expect(findEpgElsewhereChannelNames(fixture, guide, "2026-10-04T16:30:00Z")).toEqual(["CBS ELSEWHERE"]);
    expect(findEpgElsewhereChannelNames(fixture, new Map(), "2026-10-04T16:30:00Z")).toEqual([]);
  });
});

describe("Sharks at Predators, 2026-10-15", () => {
  const fixture = {
    league: "NHL",
    awayTeam: "San Jose Sharks",
    homeTeam: "Nashville Predators",
    broadcasts: ["ESPN+", "NBC Sports BA", "Scripps Sports"],
  };
  const channels = [
    { id: "nhln", name: "SP - NHL NETWORK HD" },
    { id: "espn-sj", name: "Sharks vs Predators (Sharks Broadcast)" },
    { id: "espn-nsh", name: "Sharks vs Predators (Predators Broadcast)" },
    { id: "nbcsba", name: "NBC Sports Bay Area" },
    { id: "other", name: "Kings vs Ducks (Kings Broadcast)" },
  ];

  it("offers both feeds of this very game first, then the carrying network", () => {
    const ids = findCandidateChannels(fixture, channels, 8).map((c) => c.id);
    expect(ids.slice(0, 2).sort()).toEqual(["espn-nsh", "espn-sj"]);
    expect(ids).toContain("nbcsba");
    expect(ids).not.toContain("other");
  });

  it("matches ESPN's abbreviated regional network to the spelled-out channel", () => {
    expect(channelCarriesNetwork("NBC Sports Bay Area", "NBC Sports BA")).toBe(true);
    expect(channelCarriesNetwork("NBC Sports California", "NBC Sports BA")).toBe(false);
  });

  it("needs both teams, not one", () => {
    expect(namesBothTeams("Sharks vs Predators (Sharks Broadcast)", fixture)).toBe(true);
    expect(namesBothTeams("NHL SAN JOSE SHARKS", fixture)).toBe(false);
    // The provider's per-game feed, the one that actually showed the game on 2026-10-17.
    const tonight = { awayTeam: "San Jose Sharks", homeTeam: "Detroit Red Wings" };
    expect(namesBothTeams("NHL | 07 - 7pm Sharks at Red Wings", tonight)).toBe(true);
    expect(namesBothTeams("NHL TEAM| DETROIT RED WINGS", tonight)).toBe(false);
    // Clubs ending in FC: matched by the rest of the name.
    const mls = { awayTeam: "San Diego FC", homeTeam: "LA Galaxy" };
    expect(namesBothTeams("LA Galaxy vs San Diego FC @ Oct 17 10:30 PM :MLS 14", mls)).toBe(true);
    expect(namesBothTeams("San Diego Padres vs LA Dodgers", mls)).toBe(false);
    expect(namesBothTeams("Houston Dynamo FC vs FC Dallas", { awayTeam: "Houston Dynamo FC", homeTeam: "FC Dallas" })).toBe(true);
  });
});

describe("networksOnOtherGames", () => {
  const base = { league: "NBA", startUtc: "2026-10-16T23:00:00Z", state: "in" };
  const heat = { ...base, id: "heat-magic", awayTeam: "Miami Heat", homeTeam: "Orlando Magic", broadcasts: [] };
  const celtics = { ...base, id: "bos-phi", broadcasts: ["NBA TV"] };
  const lakers = { ...base, id: "den-lal", startUtc: "2026-10-17T02:30:00Z", state: "pre", broadcasts: ["ESPN"] };
  const fox = { ...base, id: "fox-game", broadcasts: ["FOX"] };

  it("lists a national network busy with a concurrent game", () => {
    expect(networksOnOtherGames(heat, [heat, celtics, lakers, fox])).toEqual(["NBA TV"]);
  });

  it("keeps a network the fixture itself is listed on", () => {
    expect(networksOnOtherGames({ ...heat, broadcasts: ["NBA TV"] }, [heat, celtics])).toEqual([]);
  });

  it("stops NBA TV being guessed for a game it is not showing", () => {
    const channels = [{ id: "1", name: "NBA TV" }];
    expect(findCandidateChannels(heat, channels)).toHaveLength(1);
    const busy = networksOnOtherGames(heat, [heat, celtics]);
    expect(findCandidateChannels({ ...heat, networksOnOtherGames: busy }, channels)).toEqual([]);
  });
});

describe("channelCarriesNetwork regional aliases", () => {
  it("matches ESPN's NBC Sports Philadelphia abbreviations", () => {
    for (const net of ["NBCSP", "NBCS-PH", "NBC Sports PH"]) {
      expect(channelCarriesNetwork("NBC Sports Philadelphia", net)).toBe(true);
    }
  });
  it("matches MSG without MSG 2 or MSG+", () => {
    expect(channelCarriesNetwork("MSG New York", "MSG")).toBe(true);
    expect(channelCarriesNetwork("US: MSG 2 HD", "MSG")).toBe(false);
    expect(channelCarriesNetwork("US: MSG PLUS HD", "MSG")).toBe(false);
  });
});

describe("contestedLocalNetworks", () => {
  const bills = { id: "nfl:1", league: "NFL", startUtc: "2026-10-18T20:25:00Z", broadcasts: ["CBS"] };
  it("flags an over-the-air network another concurrent game shares (a Sunday window)", () => {
    const panthers = { id: "nfl:2", league: "NFL", startUtc: "2026-10-18T20:25:00Z", broadcasts: ["CBS"] };
    expect([...contestedLocalNetworks(bills, [bills, panthers])]).toEqual(["cbs"]);
  });
  it("is empty when the network carries only this game (a national window)", () => {
    const other = { id: "nfl:3", league: "NFL", startUtc: "2026-10-18T20:25:00Z", broadcasts: ["FOX"] };
    expect([...contestedLocalNetworks(bills, [bills, other])]).toEqual([]);
  });
  it("ignores a game in another league or a finished one", () => {
    const nba = { id: "nba:1", league: "NBA", startUtc: "2026-10-18T20:25:00Z", broadcasts: ["CBS"] };
    const done = { id: "nfl:4", league: "NFL", startUtc: "2026-10-18T20:25:00Z", state: "post", broadcasts: ["CBS"] };
    expect([...contestedLocalNetworks(bills, [bills, nba, done])]).toEqual([]);
  });
});

describe("networkConfirmsFixture", () => {
  const fixture = { awayTeam: "Buffalo Bills", homeTeam: "Las Vegas Raiders", broadcasts: ["CBS"] };
  const contested = new Set(["cbs"]); // a Sunday-afternoon window

  it("confirms an over-the-air affiliate in a participating team's market", () => {
    expect(networkConfirmsFixture("CBS 8 (WROC) ROCHESTER HD", fixture, contested)).toBe(true); // Bills market
    expect(networkConfirmsFixture("CBS 2 LAS VEGAS NV", fixture, contested)).toBe(true); // Raiders market
  });

  it("does NOT confirm an over-the-air affiliate in neither team's market, even the viewer's own", () => {
    expect(networkConfirmsFixture("CBS 13 BALTIMORE MD (WJZ)", fixture, contested)).toBe(false);
    // Rochester is the viewer's market but this game is Panthers/Eagles:
    const panthers = { awayTeam: "Carolina Panthers", homeTeam: "Philadelphia Eagles", broadcasts: ["CBS"] };
    expect(networkConfirmsFixture("CBS 8 (WROC) ROCHESTER HD", panthers, contested)).toBe(false);
  });

  it("confirms any affiliate in a national over-the-air window (network not contested)", () => {
    expect(networkConfirmsFixture("CBS 13 BALTIMORE MD (WJZ)", fixture, new Set())).toBe(true);
  });

  it("confirms a national cable/RSN feed by carrying the game", () => {
    const tnt = { awayTeam: "Boston Celtics", homeTeam: "Miami Heat", broadcasts: ["TNT"] };
    expect(networkConfirmsFixture("TNT", tnt)).toBe(true);
    expect(networkConfirmsFixture("CBS 13 BALTIMORE MD (WJZ)", tnt)).toBe(false);
  });
});

describe("channelMarketTeam", () => {
  it("names the team whose market a carrying affiliate is in", () => {
    const fixture = { awayTeam: "Buffalo Bills", homeTeam: "Las Vegas Raiders", broadcasts: ["CBS"] };
    expect(channelMarketTeam("CBS 8 (WROC) ROCHESTER HD", fixture)).toBe("Buffalo Bills");
    expect(channelMarketTeam("CBS 13 BALTIMORE MD (WJZ)", fixture)).toBeNull();
  });
  it("is null when the channel doesn't carry the game's network", () => {
    const fixture = { awayTeam: "Buffalo Bills", homeTeam: "Las Vegas Raiders", broadcasts: ["CBS"] };
    expect(channelMarketTeam("FOX 29 BUFFALO NY (WUTV)", fixture)).toBeNull();
  });
});

describe("Grizzlies at Warriors, 2026-10-23: never another sport's channel", () => {
  const fixture = {
    league: "NBA",
    awayTeam: "Memphis Grizzlies",
    homeTeam: "Golden State Warriors",
    broadcasts: ["NBA League Pass"],
    startUtc: "2026-10-24T02:00:00Z",
  };

  it("doesn't offer an NHL team channel because the Warriors' market includes San Jose", () => {
    const channels = [
      { id: "sharks", name: "NHL SAN JOSE SHARKS" },
      { id: "nbcsca", name: "NBC SPORTS CALIFORNIA (SHARKS)" },
      { id: "nbatv", name: "NBA TV" },
    ];
    expect(findCandidateChannels(fixture, channels, 8).map((c) => c.id)).toEqual(["nbatv"]);
  });

  it("doesn't take a shared nickname from another league", () => {
    const kings = { league: "NBA", awayTeam: "Portland Trail Blazers", homeTeam: "Sacramento Kings" };
    const channels = [
      { id: "lak", name: "NHL | 10 - 10pm Kings vs Ducks" },
      { id: "sac", name: "NBA SACRAMENTO KINGS" },
    ];
    expect(findChannelForFixture(kings, channels)?.id).toBe("sac");
    expect(resolveChannelForFixture(kings, channels)?.id).toBe("sac");
    // Without the league, as before.
    expect(findChannelForFixture({ awayTeam: kings.awayTeam, homeTeam: kings.homeTeam }, channels)?.id).toBe("lak");
  });

  it("doesn't confirm a channel from another sport's guide entry or a preview show", () => {
    const at = (title: string, description = ""): ChannelProgramme[] => [
      { title, description, startUtc: "2026-10-24T02:00:00Z", endUtc: "2026-10-24T05:00:00Z" },
    ];
    const programs = new Map<string, ChannelProgramme[]>([
      ["NBA LEAGUE PASS 1", at("Golden State Warriors vs. Memphis Grizzlies", "NBA basketball from San Francisco.")],
      ["NHL ON NBCS", at("NHL Hockey: Sharks at Senators", "Replay. Golden State Warriors and Memphis Grizzlies are on later.")],
      ["DAZN 4", at("Jessica Benson Show", "Golden State Warriors vs Memphis Grizzlies preview.")],
    ]);
    expect(findEpgConfirmedChannelNames(fixture, programs, "2026-10-24T03:04:00Z")).toEqual(["NBA LEAGUE PASS 1"]);
  });
});
