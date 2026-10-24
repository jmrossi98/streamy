import { describe, it, expect } from "vitest";
import { gameStreamQueries, gameStreamScore, rankGameStreams, TALK_SHOW_SCORE } from "../gameStreamRules";

const sharks = {
  league: "NHL",
  awayTeam: "San Jose Sharks",
  homeTeam: "Nashville Predators",
  broadcasts: ["ESPN+", "NBC Sports BA", "Scripps Sports"],
};

describe("gameStreamScore (the 2026-10-15 Sharks catalogue)", () => {
  it("puts the stream naming both teams first", () => {
    expect(gameStreamScore("NHL | 08 - 8pm Sharks at Predators", sharks)).toBe(0);
  });
  it("ranks team and network streams below it, cities last", () => {
    expect(gameStreamScore("US: SAN JOSE SHARKS", sharks)).toBe(2);
    expect(gameStreamScore("NBC Sports Bay Area", sharks)).toBe(3);
    expect(gameStreamScore("US: CBS 5 (WTVF) NASHVILLE HD", sharks)).toBe(4);
  });
  it("has no reason to offer other games or channels", () => {
    expect(gameStreamScore("NHL | 07 - 8pm Jets at Blackhawks", sharks)).toBeNull();
    expect(gameStreamScore("PRIME: NAT GEO WILD", sharks)).toBeNull();
  });
});

describe("rankGameStreams", () => {
  it("drops dead, expired-provider and already-added streams", () => {
    const streams = [
      { id: 1, name: "NHL | 08 - 8pm Sharks at Predators", provider: "strong8k" },
      { id: 2, name: "NHL SAN JOSE SHARKS", provider: "trex" },
      { id: 3, name: "US: SAN JOSE SHARKS", provider: "strong8k", stale: true },
      { id: 4, name: "US: NBC SPORTS BAY AREA", provider: "strong8k" },
      { id: 1, name: "NHL | 08 - 8pm Sharks at Predators", provider: "strong8k" },
    ];
    const got = rankGameStreams(streams, sharks, { promoted: new Set([4]), expiredProviders: new Set(["trex"]) });
    expect(got.map((s) => s.id)).toEqual([1]);
  });
  it("drops a slot whose game is over and ranks one not yet open behind one that is", () => {
    const streams = [
      { id: 1, name: "NHL | 08 - 8pm Sharks at Predators" },
      { id: 2, name: "NHL | 02 - 1pm Sharks at Predators" },
      { id: 3, name: "NHL | 05 - 5pm Sharks at Predators" },
    ];
    // 6pm Eastern on 2026-10-16: the 1pm slot is over, the 5pm one open, the 8pm one not yet.
    const now = Date.parse("2026-10-16T22:00:00Z");
    expect(rankGameStreams(streams, sharks, { now }).map((s) => s.id)).toEqual([3, 1]);
  });
});

describe("gameStreamQueries", () => {
  it("searches both sides, both cities and the carrying networks", () => {
    expect(gameStreamQueries(sharks)).toEqual(["sharks", "predators", "san jose", "nashville", "espn+", "nbc sports ba", "scripps sports"]);
  });
  it("searches by what tells two \"United\" sides apart (2026-10-18)", () => {
    const q = gameStreamQueries({ league: "Premier League", awayTeam: "Manchester United", homeTeam: "Leeds United" });
    expect(q).toContain("leeds");
    expect(q).toContain("man u");
    expect(q).not.toContain("united");
  });
});

describe("rankGameStreams other-date feeds", () => {
  it("drops a feed named for another day's game between the same teams", () => {
    const fixture = { league: "NBA", awayTeam: "Boston Celtics", homeTeam: "Philadelphia 76ers", startUtc: "2026-10-16T23:00:00Z" };
    const streams = [
      { id: 1, name: "US (Peacock 085) | Celtics vs. 76ers (2026-11-10 19:00:05)" },
      { id: 2, name: "NEXT | PHI - 76ERS VS BOS - CELTICS | Fri 16 Oct 18:00 EDT (US)" },
    ];
    const ids = rankGameStreams(streams, fixture, { now: Date.parse("2026-10-16T23:30:00Z") }).map((s) => s.id);
    expect(ids).toEqual([2]);
  });
});

describe("feedLanguageRank", () => {
  it("English first, other countries last", async () => {
    const { feedLanguageRank } = await import("../gameStreamRules");
    expect(feedLanguageRank("AU (STAN 34) | Leeds United v Manchester United")).toBe(0);
    expect(feedLanguageRank("Next | Leeds United vs Manchester United || English | Premier League")).toBe(0);
    expect(feedLanguageRank("Next | Leeds x Man. United | Premier League | 2026-10-18 | 13:00 (GMT) | 8K EXCLUSIVE | PT: DAZN PPV 42")).toBe(2);
    expect(feedLanguageRank("NEXT | PREMIER LEAGUE LEEDS - MAN UNITED | Sun 18 Oct 14:00 CEST (DK) | 8K EXCLUSIVE | DK: VIAPLAY P")).toBe(2);
    expect(feedLanguageRank("NHL | 12 - 9pm Bruins at Kings")).toBe(1);
  });
});

describe("Grizzlies at Warriors, 2026-10-23: an NHL Sharks picture on an NBA game", () => {
  const fixture = {
    league: "NBA",
    awayTeam: "Memphis Grizzlies",
    homeTeam: "Golden State Warriors",
    broadcasts: ["NBA League Pass"],
    startUtc: "2026-10-24T02:00:00Z",
  };
  const now = Date.parse("2026-10-24T03:04:18Z");
  const streams = [
    { id: 95502, name: "End | Tigers OT Win vs ECU, Grizzlies/Warriors, Tyran Stokes, CFB & NFL Weekend | Chris Vernon Show | NBA | 2026-10-23 | 17:00 (GMT) | 8K EXCLUSIVE | US: DAZN PPV 16" },
    { id: 95466, name: "End | Grizzlies Vs. Warriors Preview, Ja Morant Update | Jessica Benson Show | NBA | 2026-10-23 | 13:00 (GMT) | 8K EXCLUSIVE | US: DAZN PPV 4" },
    { id: 84823, name: "NEXT | GSW - WARRIORS VS MEM - GRIZZLIES | Fri 23 Oct 21:00 EDT (US) | 8K EXCLUSIVE | US: NBA PASS PPV 10" },
    { id: 84942, name: "Golden State Warriors vs Memphis Grizzlies @ Oct 23 10:00 PM :NBA  10" },
    { id: 93120, name: "LIVE | GSW - WARRIORS VS MEM - GRIZZLIES | Fri 23 Oct 21:00 EDT (US) | 8K EXCLUSIVE | US: NBA PASS PPV 10" },
    { id: 1, name: "NHL | 10 - 10pm Sharks at Warriors" },
    { id: 2, name: "NHL SAN JOSE SHARKS" },
    { id: 3, name: "US: NBC SPORTS CALIFORNIA | Sharks vs Senators" },
  ];

  it("offers the LIVE feed first, never a finished show, the NEXT slot or another sport", () => {
    expect(rankGameStreams(streams, fixture, { now }).map((s) => s.id)).toEqual([93120, 84942]);
  });

  it("scores the shows and other sports out", () => {
    expect(gameStreamScore(streams[0].name, fixture)).toBeNull();
    expect(gameStreamScore(streams[1].name, fixture)).toBeNull();
    expect(gameStreamScore("NHL | 10 - 10pm Sharks at Warriors", fixture)).toBeNull();
    expect(gameStreamScore("San Jose Sharks Hockey", fixture)).toBeNull();
    expect(gameStreamScore(streams[4].name, fixture)).toBe(0);
  });

  it("keeps the NEXT slot when there is no LIVE entry", () => {
    const ids = rankGameStreams(streams.filter((s) => s.id !== 93120), fixture, { now }).map((s) => s.id);
    expect(ids).toContain(84823);
  });

  it("offers a show about the game last, and only when nothing else names it", () => {
    const show = { id: 7, name: "Grizzlies vs Warriors Postgame Show" };
    expect(gameStreamScore(show.name, fixture)).toBe(TALK_SHOW_SCORE);
    expect(rankGameStreams([show, streams[3]], fixture, { now }).map((s) => s.id)).toEqual([84942]);
    expect(rankGameStreams([show], fixture, { now }).map((s) => s.id)).toEqual([7]);
  });
});
