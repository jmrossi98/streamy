import { describe, it, expect } from "vitest";
import { nameHasBothTeams, nameHasTeam, teamIdentifiers, teamSearchTerms } from "../teamNames";

const MU = "Manchester United";
const LU = "Leeds United";

describe("nameHasBothTeams: teams sharing a last word (2026-10-18)", () => {
  it("finds the real feeds, however they write it", () => {
    for (const n of [
      "NEXT | PREMIER LEAGUE LEEDS - MAN UNITED | Sun 18 Oct 14:00 CEST (DK)",
      "Next | Leeds x Man. United | Premier League | 2026-10-18 | 13:00 (GMT)",
      "Next | Leeds United - Manchester United | Premier League | 2026-10-18",
      "AU (STAN 34) | Leeds United v Manchester United  Premier League Matchweek 7",
      "Leeds vs Man Utd",
    ]) {
      expect(nameHasBothTeams(n, MU, LU)).toBe(true);
    }
  });
  it("never a stream that only shares the word", () => {
    expect(nameHasBothTeams("Next | Masters FC vs. Karonga United | Super League - Malawi", MU, LU)).toBe(false);
    expect(nameHasBothTeams("Manchester City vs Leeds United", MU, LU)).toBe(false);
    expect(nameHasBothTeams("West Ham United vs Newcastle United", MU, LU)).toBe(false);
  });
  it("doesn't trust a place with two clubs on its own", () => {
    expect(teamIdentifiers(MU, LU)).not.toContain("manchester");
    expect(teamIdentifiers(LU, MU)).toContain("leeds");
  });
});

describe("ordinary teams work as before", () => {
  it("nickname teams", () => {
    expect(nameHasBothTeams("NHL | 07 - 7pm Sharks at Red Wings", "San Jose Sharks", "Detroit Red Wings")).toBe(true);
    expect(nameHasBothTeams("NHL TEAM| SAN JOSE SHARKS", "San Jose Sharks", "Detroit Red Wings")).toBe(false);
  });
  it("FC clubs", () => {
    expect(nameHasBothTeams("LA Galaxy vs San Diego FC @ Oct 17 10:30 PM :MLS 14", "San Diego FC", "LA Galaxy")).toBe(true);
    expect(nameHasBothTeams("Houston Dynamo FC vs FC Dallas", "Houston Dynamo FC", "FC Dallas")).toBe(true);
    expect(nameHasTeam("San Diego Padres vs LA Dodgers", "San Diego FC", "LA Galaxy")).toBe(true);
    expect(nameHasBothTeams("San Diego Padres vs LA Dodgers", "San Diego FC", "LA Galaxy")).toBe(false);
  });
});

describe("teamSearchTerms", () => {
  it("searches by what tells the teams apart", () => {
    expect(teamSearchTerms(LU, MU)).toContain("leeds");
    expect(teamSearchTerms(MU, LU).some((t) => t.startsWith("man u") || t === "man utd")).toBe(true);
    expect(teamSearchTerms(MU, LU)).not.toContain("united");
  });
});
