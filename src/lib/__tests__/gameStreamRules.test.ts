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
});

describe("gameStreamQueries", () => {
  it("searches both sides, both cities and the carrying networks", () => {
    expect(gameStreamQueries(sharks)).toEqual(["Sharks", "Predators", "San Jose", "Nashville", "ESPN+", "NBC Sports BA", "Scripps Sports"]);
  });
});
