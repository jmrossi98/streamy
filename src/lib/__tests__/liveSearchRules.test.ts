import { describe, it, expect } from "vitest";
import { matchChannels, matchGames } from "../liveSearchRules";

const games = [
  { id: "1", name: "Sharks at Predators", league: "NHL", detail: "2nd Period", state: "in" as const, awayTeam: "San Jose Sharks", homeTeam: "Nashville Predators" },
  { id: "2", name: "Kings at Ducks", league: "NHL", detail: "10:00 PM", state: "pre" as const, awayTeam: "Los Angeles Kings", homeTeam: "Anaheim Ducks" },
  { id: "3", name: "Bills at Jets", league: "NFL", detail: "Final", state: "post" as const, awayTeam: "Buffalo Bills", homeTeam: "New York Jets" },
];

describe("matchGames", () => {
  it("finds a game by team, city or league, live ones first, never finished ones", () => {
    expect(matchGames("sharks", games).map((g) => g.id)).toEqual(["1"]);
    expect(matchGames("san jose", games).map((g) => g.id)).toEqual(["1"]);
    expect(matchGames("nhl", games).map((g) => g.id)).toEqual(["1", "2"]);
    expect(matchGames("bills", games)).toEqual([]);
  });
  it("matches word starts, not the middle of words", () => {
    expect(matchGames("shar", games).map((g) => g.id)).toEqual(["1"]);
    expect(matchGames("arks", games)).toEqual([]);
  });
});

describe("matchChannels", () => {
  const channels = [
    { id: "a", name: "NBC Sports Bay Area", number: "2249", nowName: "Sharks at Predators" },
    { id: "b", name: "ESPN", number: "2201", nowName: "SportsCenter" },
    { id: "c", name: "MeTV", number: "2210", nowName: "M*A*S*H" },
  ];
  it("matches the name first, then what is on now, and the channel number", () => {
    expect(matchChannels("nbc sports", channels).map((c) => c.id)).toEqual(["a"]);
    expect(matchChannels("sharks", channels).map((c) => c.id)).toEqual(["a"]);
    expect(matchChannels("2210", channels).map((c) => c.id)).toEqual(["c"]);
    expect(matchChannels("", channels)).toEqual([]);
  });
});
