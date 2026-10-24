import { describe, it, expect } from "vitest";
import {
  entryStatus,
  looksLikeTalkShow,
  namedLeagues,
  programmeSportConflict,
  sameSport,
  sportConflict,
} from "../sportMatchRules";

// 2026-10-23: Grizzlies at Warriors, and what the stream finder checked for it.
const warriors = { league: "NBA", awayTeam: "Memphis Grizzlies", homeTeam: "Golden State Warriors" };
const LIVE = "LIVE | GSW - WARRIORS VS MEM - GRIZZLIES | Fri 23 Oct 21:00 EDT (US) | 8K EXCLUSIVE | US: NBA PASS PPV 10";
const NEXT = "NEXT | GSW - WARRIORS VS MEM - GRIZZLIES | Fri 23 Oct 21:00 EDT (US) | 8K EXCLUSIVE | US: NBA PASS PPV 10";
const DATED = "Golden State Warriors vs Memphis Grizzlies @ Oct 23 10:00 PM :NBA  10";
const VERNON =
  "End | Tigers OT Win vs ECU, Grizzlies/Warriors, Tyran Stokes, CFB & NFL Weekend | Chris Vernon Show | NBA | 2026-10-23 | 17:00 (GMT) | 8K EXCLUSIVE | US: DAZN PPV 16";
const BENSON =
  "End | Grizzlies Vs. Warriors Preview, Ja Morant Update | Jessica Benson Show | NBA | 2026-10-23 | 13:00 (GMT) | 8K EXCLUSIVE | US: DAZN PPV 4";

describe("sportConflict", () => {
  it("keeps the game's own feeds", () => {
    for (const name of [LIVE, NEXT, DATED, "NBA LEAGUE PASS 1", "NBA TV", "NBC Sports Bay Area", "ESPN"]) {
      expect(sportConflict(name, warriors)).toBeNull();
    }
  });

  it("rejects an NHL Sharks feed for an NBA game, by league tag or by nickname", () => {
    expect(sportConflict("NHL | 08 - 8pm Sharks at Predators", warriors)).toBe("names NHL");
    expect(sportConflict("NHL SAN JOSE SHARKS", warriors)).toBe("names NHL");
    expect(sportConflict("Sharks Broadcast (ESPN+ 322)", warriors)).toBe("names the sharks (NHL)");
    expect(sameSport("San Jose Sharks at Ottawa Senators @ Oct 22 7:00 PM :NHL 3", warriors)).toBe(false);
  });

  it("rejects other leagues' tags", () => {
    expect(sameSport("NFL | 03 - 1pm Patriots at Bills", warriors)).toBe(false);
    expect(sameSport("MLB NETWORK", warriors)).toBe(false);
    expect(sameSport("NCAAF: Memphis vs ECU", warriors)).toBe(false);
    expect(sameSport("LA Galaxy vs San Diego FC @ Oct 17 10:30 PM :MLS 14", warriors)).toBe(false);
  });

  it("matches nicknames, not cities", () => {
    // "Memphis" and "San Jose" are not evidence of anything.
    expect(sameSport("US: CBS 3 MEMPHIS (WREG)", warriors)).toBe(true);
    expect(sameSport("CW 36 SAN JOSE", warriors)).toBe(true);
    // "Tigers" is.
    expect(sameSport("Detroit Tigers vs Cleveland Guardians", warriors)).toBe(false);
  });

  it("never holds a nickname two leagues share against either", () => {
    const kings = { league: "NBA", awayTeam: "Portland Trail Blazers", homeTeam: "Sacramento Kings" };
    expect(sameSport("Trail Blazers vs Kings (Kings Broadcast)", kings)).toBe(true);
    const panthers = { league: "NHL", awayTeam: "Florida Panthers", homeTeam: "Boston Bruins" };
    expect(sameSport("Panthers at Bruins", panthers)).toBe(true);
    // But an NFL nickname that isn't an NHL one is.
    expect(sameSport("Panthers vs Falcons", panthers)).toBe(false);
  });

  it("is loose within soccer and leaves unknown leagues alone", () => {
    const ucl = { league: "Champions League", awayTeam: "Arsenal", homeTeam: "Bayern Munich" };
    expect(sameSport("EPL | Arsenal TV", ucl)).toBe(true);
    expect(sameSport("NBA TV", ucl)).toBe(false);
    // Soccer nicknames overlap the NBA's ("Spurs"): no nickname check there.
    expect(sameSport("Spurs vs Arsenal", { league: "Premier League", awayTeam: "Arsenal", homeTeam: "Chelsea" })).toBe(true);
    expect(sportConflict("NHL NETWORK", { league: "Cricket" })).toBeNull();
  });

  it("reads bare NCAA as either college league", () => {
    expect(sameSport("NCAA | Duke vs UNC", { league: "College Basketball" })).toBe(true);
    expect(sameSport("NCAA | Duke vs UNC", { league: "NBA" })).toBe(false);
  });
});

describe("namedLeagues", () => {
  it("does not read WNBA as NBA", () => {
    expect(namedLeagues("WNBA | Aces vs Liberty")).toEqual(["WNBA"]);
    expect(namedLeagues(VERNON).sort()).toEqual(["College Football", "NBA", "NFL"]);
  });
});

describe("entryStatus", () => {
  it("reads the provider's status prefix", () => {
    expect(entryStatus(LIVE)).toBe("live");
    expect(entryStatus(NEXT)).toBe("next");
    expect(entryStatus(VERNON)).toBe("end");
    expect(entryStatus(DATED)).toBeNull();
    expect(entryStatus("LIVE EVENT 01 - UFC 331")).toBeNull();
  });
});

describe("looksLikeTalkShow", () => {
  it("spots shows about the game", () => {
    expect(looksLikeTalkShow(VERNON)).toBe(true);
    expect(looksLikeTalkShow(BENSON)).toBe(true);
    expect(looksLikeTalkShow("Warriors Postgame Live")).toBe(true);
    expect(looksLikeTalkShow("NBA Highlights")).toBe(true);
  });
  it("leaves games and networks alone", () => {
    for (const name of [LIVE, NEXT, DATED, "SHOWTIME HD", "Sharks vs Predators (Sharks Broadcast)"]) {
      expect(looksLikeTalkShow(name)).toBe(false);
    }
  });
});

describe("programmeSportConflict", () => {
  it("rejects another sport's guide entry", () => {
    expect(programmeSportConflict({ title: "Live: NHL Hockey" }, warriors)).toBe(true);
    expect(programmeSportConflict({ title: "Sharks at Senators", description: "From Ottawa." }, warriors)).toBe(true);
    expect(programmeSportConflict({ title: "College Football", description: "Memphis at ECU" }, warriors)).toBe(true);
  });
  it("keeps this sport's and ones that don't say", () => {
    expect(programmeSportConflict({ title: "Live: NBA Basketball" }, warriors)).toBe(false);
    expect(programmeSportConflict({ title: "Grizzlies at Warriors" }, warriors)).toBe(false);
    expect(programmeSportConflict({ title: "Paid Programming" }, warriors)).toBe(false);
    // A British guide's "football" is soccer.
    const epl = { league: "Premier League", awayTeam: "Arsenal", homeTeam: "Chelsea" };
    expect(programmeSportConflict({ title: "Premier League Football" }, epl)).toBe(false);
    expect(programmeSportConflict({ title: "Live: NFL Football" }, epl)).toBe(true);
  });
});
