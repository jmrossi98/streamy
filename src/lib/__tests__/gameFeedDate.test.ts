import { describe, it, expect } from "vitest";
import { namesGameDate, namesOtherDate } from "../liveGuideGrid";
import { rankGameStreams } from "../gameStreamRules";

// Bruins at Kings, 2026-10-18 01:00Z = Oct 17, 9pm eastern.
const START = Date.parse("2026-10-18T01:00:00Z");
const fixture = {
  league: "NHL",
  awayTeam: "Boston Bruins",
  homeTeam: "Los Angeles Kings",
  startUtc: "2026-10-18T01:00:00Z",
};
const ESPN = "US (ESPN+ 435) | Boston Bruins vs. Los Angeles Kings Oct 17 8:30PM ET (2026-10-17 20:30:05)";
const SLOT = "NHL | 12 - 9pm Bruins at Kings";

describe("namesGameDate", () => {
  it("reads the game's date in every form the providers use", () => {
    expect(namesGameDate(ESPN, START)).toBe(true);
    expect(namesGameDate("NEXT | SAN JOSE SHARKS VS. DETROIT RED WINGS | Sat 17 Oct 19:00 EDT", START)).toBe(true);
    expect(namesGameDate("Bruins vs Kings @ Oct 17 9:00 PM :Sportsnet+ 12", START)).toBe(true);
  });
  it("is false for a slot with no date, or another date", () => {
    expect(namesGameDate(SLOT, START)).toBe(false);
    expect(namesGameDate("Bruins vs Kings (2026-11-10 19:00:05)", START)).toBe(false);
    expect(namesOtherDate("Bruins vs Kings (2026-11-10 19:00:05)", START)).toBe(true);
  });
  it("reads day-first dates too", () => {
    const leeds = Date.parse("2026-10-18T13:00:00Z");
    expect(namesGameDate("Next | Leeds United vs Manchester United || English | Premier League | 18-10-2026 | 12:40 (GMT)", leeds)).toBe(true);
  });
  it("doesn't read a time as a day", () => {
    expect(namesGameDate("Oct 17:30 replay", START)).toBe(false);
  });
});

describe("rankGameStreams", () => {
  it("puts the feed carrying the game's date ahead of an undated slot", () => {
    const ranked = rankGameStreams(
      [
        { id: 1, name: SLOT, provider: "trex" },
        { id: 2, name: ESPN, provider: "strong8k" },
      ],
      fixture,
      { now: START + 60 * 60_000 }
    );
    expect(ranked.map((s) => s.id)).toEqual([2, 1]);
  });
});
