import { describe, expect, it } from "vitest";
import {
  channelInTeamMarket,
  fixtureMarketSide,
  inMarketTeam,
  teamMarketCities,
} from "../teamMarkets";

describe("teamMarketCities", () => {
  it("maps a team to its broadcast metro, not just the word in its name", () => {
    expect(teamMarketCities("Carolina Panthers")).toContain("charlotte");
    expect(teamMarketCities("New England Patriots")).toContain("boston");
    expect(teamMarketCities("Golden State Warriors")).toEqual(expect.arrayContaining(["san francisco", "san jose"]));
    expect(teamMarketCities("Buffalo Bills")).toEqual(expect.arrayContaining(["buffalo", "rochester"]));
  });

  it("is null for a team it doesn't map (soccer, etc.)", () => {
    expect(teamMarketCities("Leeds United")).toBeNull();
    expect(teamMarketCities(null)).toBeNull();
  });
});

describe("channelInTeamMarket", () => {
  it("matches an affiliate in the team's metro as whole words", () => {
    expect(channelInTeamMarket("CBS 8 (WROC) ROCHESTER HD", "Buffalo Bills")).toBe(true);
    expect(channelInTeamMarket("FOX 29 PHILADELPHIA PA", "Philadelphia Eagles")).toBe(true);
    expect(channelInTeamMarket("CBS 13 BALTIMORE MD (WJZ)", "Las Vegas Raiders")).toBe(false);
    expect(channelInTeamMarket("CBS 13 BALTIMORE MD (WJZ)", "Carolina Panthers")).toBe(false);
  });

  it("does not light up on a substring of a longer word", () => {
    // "charlotte" should not match inside something like "charlottesville" — guard the boundary
    expect(channelInTeamMarket("WX CHARLOTTESVILLE VA", "Carolina Panthers")).toBe(false);
  });

  it("handles multi-word metros", () => {
    expect(channelInTeamMarket("CBS 2 LAS VEGAS NV", "Las Vegas Raiders")).toBe(true);
    expect(channelInTeamMarket("NBC BAY AREA SAN FRANCISCO", "Golden State Warriors")).toBe(true);
  });
});

describe("fixtureMarketSide / inMarketTeam", () => {
  const fixture = { awayTeam: "Buffalo Bills", homeTeam: "Las Vegas Raiders" };

  it("tells which side's market a channel is in", () => {
    expect(fixtureMarketSide("CBS 8 (WROC) ROCHESTER HD", fixture)).toBe("away");
    expect(fixtureMarketSide("CBS 2 LAS VEGAS NV", fixture)).toBe("home");
    expect(fixtureMarketSide("CBS 13 BALTIMORE MD (WJZ)", fixture)).toBeNull();
  });

  it("names the in-market team for a badge", () => {
    expect(inMarketTeam("CBS 8 (WROC) ROCHESTER HD", fixture)).toBe("Buffalo Bills");
    expect(inMarketTeam("CBS 13 BALTIMORE MD (WJZ)", fixture)).toBeNull();
  });
});
