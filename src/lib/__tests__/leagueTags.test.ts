import { describe, expect, it } from "vitest";
import { leagueTag } from "../leagueTags";

describe("leagueTag", () => {
  it("abbreviates the long league names", () => {
    expect(leagueTag("College Football")).toBe("NCAAF");
    expect(leagueTag("Premier League")).toBe("EPL");
  });
  it("leaves short ones alone", () => {
    expect(leagueTag("NHL")).toBe("NHL");
    expect(leagueTag("La Liga")).toBe("La Liga");
  });
});
