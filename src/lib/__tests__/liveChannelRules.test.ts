import { describe, expect, it } from "vitest";
import {
  channelVerdict,
  liveAliases,
  STATE_RANK,
  teamsInChannelName,
  type FixtureLike,
} from "../liveChannelRules";

const healthy = { playable: true, frozen: false, silent: false };

const fixture = (
  state: string,
  awayTeam: string | null,
  homeTeam: string | null
): FixtureLike => ({ state, awayTeam, homeTeam });

/**
 * These encode a measurement, not a guess. On 2026-09-26 no NFL, NBA or NHL
 * game was in progress -- the Bills fixture was the next afternoon -- and both
 * "NFL CBS BILLS GIANTS JETS NEW YORK NY" and "NHL BUFFALO SABRES" were
 * streaming h264 with audio, sharing one encoder profile. Neither tripped
 * freezedetect or silencedetect, because the filler moves and has sound.
 */
describe("teamsInChannelName", () => {
  it("finds a team by nickname in a provider's channel name", () => {
    expect(teamsInChannelName("NHL BUFFALO SABRES").map((t) => t.aliases[0])).toEqual([
      "sabres",
    ]);
  });

  it("finds every team a regional slot lists", () => {
    const t = teamsInChannelName("NFL CBS BILLS GIANTS JETS NEW YORK NY");
    expect(t.map((x) => x.aliases[0]).sort()).toEqual(["bills", "giants", "jets"]);
  });

  it("does not match a city shared by several teams", () => {
    // Why aliases are nicknames: "NEW YORK" is in the Knicks, Jets and Giants
    // names at once, so a city match would call a Knicks channel live because
    // the Jets are playing.
    expect(teamsInChannelName("US: NEW YORK")).toEqual([]);
  });

  it("does not match a nickname inside a longer word", () => {
    expect(teamsInChannelName("BILLSBOROUGH COMMUNITY TV")).toEqual([]);
  });

  it("returns nothing for a network feed", () => {
    expect(teamsInChannelName("NFL - NFL NETWORK HD")).toEqual([]);
    expect(teamsInChannelName("SP - NBC SPORTS HD")).toEqual([]);
  });
});

describe("liveAliases", () => {
  it("counts only games actually in progress", () => {
    // A fixture that is pre has not started and one that is post is over; a
    // channel advertising the team is filler in both cases, which is the
    // entire question being asked.
    const fixtures = [
      fixture("pre", "Los Angeles Chargers", "Buffalo Bills"),
      fixture("post", "Boston Bruins", "Washington Capitals"),
    ];
    expect(liveAliases(fixtures).size).toBe(0);
  });

  it("picks up a tracked team from either side of a fixture", () => {
    expect(liveAliases([fixture("in", "Buffalo Sabres", "Toronto Maple Leafs")])).toContain(
      "sabres"
    );
    expect(liveAliases([fixture("in", "Toronto Maple Leafs", "Buffalo Sabres")])).toContain(
      "sabres"
    );
  });

  it("separates the two Buffalo teams by nickname, not by league", () => {
    // Buffalo fields both the Bills and the Sabres. Nicknames identify one
    // team each, so no league disambiguation is needed anywhere.
    const live = liveAliases([fixture("in", "Buffalo Sabres", "Toronto Maple Leafs")]);
    expect(live.has("sabres")).toBe(true);
    expect(live.has("bills")).toBe(false);
  });

  it("ignores teams that are not tracked", () => {
    expect(liveAliases([fixture("in", "Dallas Stars", "Minnesota Wild")]).size).toBe(0);
  });
});

describe("channelVerdict", () => {
  it("calls an unplayable channel down, whatever the schedule says", () => {
    // Five of twenty-five were genuinely dead in the first real sweep --
    // HTTP 503 and "Invalid data found" -- and Streamy showed no sign of it.
    const v = channelVerdict(
      "US: SAN JOSE SHARKS",
      { playable: false, detail: "HTTP error 503 Service Unavailable" },
      new Set(["sharks"])
    );
    expect(v.state).toBe("down");
    expect(v.detail).toContain("503");
  });

  it("calls a still, silent picture a placeholder rather than 'no game on'", () => {
    // There may well be a game; this channel just is not carrying it. Saying
    // "no game in progress" would be a false statement about the world.
    const v = channelVerdict(
      "NHL BUFFALO SABRES",
      { playable: true, frozen: true, silent: true },
      new Set(["sabres"])
    );
    expect(v.state).toBe("filler");
  });

  it("trusts a team channel only while that team is playing", () => {
    expect(channelVerdict("NHL BUFFALO SABRES", healthy, new Set(["sabres"])).state).toBe(
      "live"
    );

    const notLive = channelVerdict("NHL BUFFALO SABRES", healthy, new Set());
    expect(notLive.state).toBe("no-event");
    expect(notLive.detail).toContain("sabres");
  });

  it("is satisfied when any one team on a regional slot is playing", () => {
    const v = channelVerdict("NFL CBS BILLS GIANTS JETS NEW YORK NY", healthy, new Set(["jets"]));
    expect(v.state).toBe("live");
  });

  it("does not let one Buffalo team vouch for the other", () => {
    const v = channelVerdict("NFL CBS BILLS GIANTS JETS", healthy, new Set(["sabres"]));
    expect(v.state).toBe("no-event");
  });

  it("leaves network feeds alone", () => {
    // Nothing to cross-reference: a network carries what it carries.
    expect(channelVerdict("NFL - NFL NETWORK HD", healthy, new Set()).state).toBe("live");
  });

  it("says the schedule is unavailable rather than condemning every channel", () => {
    // null is not an empty set. Treating a failed lookup as "nothing is on"
    // would tell the viewer their working channels are dead.
    expect(channelVerdict("NHL BUFFALO SABRES", healthy, null).state).toBe("unknown");
  });

  it("reports unknown when the channel has not been checked", () => {
    expect(channelVerdict("anything", null, new Set()).state).toBe("unknown");
  });
});

describe("STATE_RANK", () => {
  it("puts what can actually be watched first and dead channels last", () => {
    expect(STATE_RANK.live).toBeLessThan(STATE_RANK["no-event"]);
    expect(STATE_RANK["no-event"]).toBeLessThan(STATE_RANK.down);
    expect(Math.max(...Object.values(STATE_RANK))).toBe(STATE_RANK.down);
  });
});
