import { describe, expect, it } from "vitest";
import {
  DEAD_RECHECK_MS,
  FOLLOW_WINDOW_MS,
  PREP_GAMES_PER_RUN,
  PREP_PROBES_PER_GAME,
  fixturesToPrep,
  followedTeams,
  prepCandidates,
  providersInUse,
  teamKey,
  type Visit,
} from "../gamePrepRules";

const NOW = Date.parse("2026-11-12T23:00:00Z");
const DAY = 86_400_000;

function visit(fixtureId: string, homeTeam: string, awayTeam: string, daysAgo: number, userId = "ana", league = "NHL"): Visit {
  return { userId, fixtureId, league, homeTeam, awayTeam, visitedAt: NOW - daysAgo * DAY };
}

describe("followedTeams", () => {
  // Ana's picks from 2026-10-17 to 2026-11-12: four Sharks games.
  const ana = [
    visit("NHL:401892525", "San Jose Sharks", "Anaheim Ducks", 26),
    visit("NHL:401892595", "San Jose Sharks", "Buffalo Sabres", 15),
    visit("NHL:401892669", "Dallas Stars", "San Jose Sharks", 5),
    visit("NHL:401892695", "San Jose Sharks", "Pittsburgh Penguins", 1),
  ];

  it("follows a team whose games someone opened more than once", () => {
    const followed = followedTeams(ana, NOW);
    expect(followed.has(teamKey("NHL", "San Jose Sharks"))).toBe(true);
    // Each opponent was opened once: not followed.
    expect(followed.has(teamKey("NHL", "Pittsburgh Penguins"))).toBe(false);
    expect(followed.size).toBe(1);
  });

  it("does not follow a team from one look at one game", () => {
    // Giants at Eagles, opened after the game to check a channel (2026-11-08).
    expect(followedTeams([visit("NFL:401873044", "Philadelphia Eagles", "New York Giants", 4, "jaker", "NFL")], NOW).size).toBe(0);
  });

  it("counts the same game opened twice, or by two people, once", () => {
    const twice = [visit("NHL:1", "San Jose Sharks", "Seattle Kraken", 2), visit("NHL:1", "San Jose Sharks", "Seattle Kraken", 2, "jaker")];
    expect(followedTeams(twice, NOW).size).toBe(0);
  });

  it("forgets visits older than the window", () => {
    const old = [visit("NHL:1", "San Jose Sharks", "A", 70), visit("NHL:2", "San Jose Sharks", "B", 65)];
    expect(followedTeams(old, NOW).size).toBe(0);
    expect(FOLLOW_WINDOW_MS).toBe(60 * DAY);
  });

  it("keeps leagues apart: the Kings of the NBA are not the Kings of the NHL", () => {
    const mixed = [visit("NHL:1", "Los Angeles Kings", "A", 2), visit("NBA:2", "Sacramento Kings", "B", 3, "ana", "NBA")];
    expect(followedTeams(mixed, NOW).size).toBe(0);
  });
});

describe("fixturesToPrep", () => {
  const followed = new Set([teamKey("NHL", "San Jose Sharks"), teamKey("NFL", "Buffalo Bills")]);
  const fx = (id: string, state: "pre" | "in" | "post", startUtc: string | null, homeTeam: string, awayTeam: string, league = "NHL") => ({
    id,
    league,
    state,
    startUtc,
    homeTeam,
    awayTeam,
  });

  it("takes a followed team's game that is on, or starts within 45 minutes", () => {
    const games = fixturesToPrep(
      [
        fx("on", "in", "2026-11-12T22:10:00Z", "San Jose Sharks", "Pittsburgh Penguins"),
        fx("soon", "pre", "2026-11-12T23:40:00Z", "Buffalo Bills", "Miami Dolphins", "NFL"),
        fx("later", "pre", "2026-11-13T01:00:00Z", "Dallas Stars", "San Jose Sharks"),
        fx("done", "post", "2026-11-12T19:00:00Z", "San Jose Sharks", "Seattle Kraken"),
        fx("other", "in", "2026-11-12T22:00:00Z", "Boston Bruins", "New York Rangers"),
      ],
      followed,
      NOW
    );
    expect(games.map((g) => g.id)).toEqual(["on", "soon"]);
  });

  it("matches the team in its own league only", () => {
    const games = fixturesToPrep([fx("nba", "in", "2026-11-12T22:00:00Z", "San Jose Sharks", "X", "NBA")], followed, NOW);
    expect(games).toEqual([]);
  });

  it("takes at most a couple of games per run, soonest first", () => {
    const many = [3, 1, 2].map((n) => fx(`g${n}`, "in", `2026-11-12T2${n}:00:00Z`, "San Jose Sharks", `Team ${n}`));
    expect(fixturesToPrep(many, followed, NOW).map((g) => g.id)).toEqual(["g1", "g2"].slice(0, PREP_GAMES_PER_RUN));
  });
});

describe("providersInUse", () => {
  const accounts = [
    { name: "trex", lines: [{ id: 1, viewers: 0 }, { id: 2, viewers: 0 }] },
    { name: "strong8k", lines: [{ id: 3, viewers: 0 }] },
  ];

  it("is the providers with a connection open on one of their lines", () => {
    expect([...providersInUse(accounts, [{ lineId: 2 }])]).toEqual(["trex"]);
  });

  it("counts a line's own viewer counter too", () => {
    const counted = accounts.map((a) => (a.name === "strong8k" ? { ...a, lines: [{ id: 3, viewers: 1 }] } : a));
    expect([...providersInUse(counted, null)]).toEqual(["strong8k"]);
  });

  it("is empty when nobody is watching", () => {
    expect(providersInUse(accounts, []).size).toBe(0);
  });
});

describe("prepCandidates", () => {
  const ranked = [
    { id: 1, provider: "trex", score: 0 },
    { id: 2, provider: "strong8k", score: 0 },
    { id: 3, provider: "trex", score: 1 },
    { id: 4, provider: "trex", score: 2 },
    { id: 5, provider: null, score: null },
  ];

  it("checks only streams that name the game, best first", () => {
    expect(prepCandidates(ranked, new Set(), new Map(), NOW).map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("leaves out a provider someone is watching", () => {
    expect(prepCandidates(ranked, new Set(["trex"]), new Map(), NOW).map((c) => c.id)).toEqual([2]);
  });

  it("leaves a stream found dead alone for a while, then tries it again", () => {
    const dead = new Map([[1, NOW - 60_000]]);
    expect(prepCandidates(ranked, new Set(), dead, NOW).map((c) => c.id)).toEqual([2, 3]);
    expect(prepCandidates(ranked, new Set(), dead, NOW + DEAD_RECHECK_MS).map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("checks a few per run at most", () => {
    const lots = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, provider: "trex", score: 0 }));
    expect(prepCandidates(lots, new Set(), new Map(), NOW)).toHaveLength(PREP_PROBES_PER_GAME);
  });
});
