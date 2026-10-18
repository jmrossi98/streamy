import { describe, it, expect } from "vitest";
import { gameStreamQueries, gameStreamScore, rankGameStreams } from "../gameStreamRules";

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
