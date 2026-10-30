import { describe, expect, it } from "vitest";
import {
  MAX_STALL_SWITCHES,
  MIN_PLAY_BEFORE_JUDGING_MS,
  SESSION_LOST_HIDDEN_MS,
  feedStillNamesGame,
  isChronicStalling,
  resumeAction,
  shouldRescanForFeed,
  stallFailoverOrder,
} from "../liveFailoverRules";
import { MAX_STALLS, STALL_WINDOW_MS } from "../liveStreamAlertRules";

const T0 = 1_000_000_000;

describe("isChronicStalling", () => {
  const playing = T0;
  const now = T0 + 4 * 60_000;
  // Ana's evening, 2026-10-27: six stalls of 0.7-5.2 s in four minutes.
  const ana = [
    { at: T0 + 30_000, ms: 700 },
    { at: T0 + 70_000, ms: 2_100 },
    { at: T0 + 110_000, ms: 5_200 },
    { at: T0 + 150_000, ms: 1_800 },
    { at: T0 + 190_000, ms: 3_000 },
    { at: T0 + 230_000, ms: 1_400 },
  ];

  it("calls the Sabres at Sharks feed chronic", () => {
    expect(isChronicStalling(ana, playing, now)).toBe(true);
  });

  it("uses the alert's thresholds: MAX_STALLS is fine, one more is not", () => {
    const stalls = Array.from({ length: MAX_STALLS }, (_, i) => ({ at: T0 + 100_000 + i * 10_000, ms: 1_500 }));
    expect(isChronicStalling(stalls, playing, T0 + 200_000)).toBe(false);
    expect(isChronicStalling([...stalls, { at: T0 + 190_000, ms: 1_500 }], playing, T0 + 200_000)).toBe(true);
  });

  it("counts time stalled as well as the number of stalls", () => {
    expect(isChronicStalling([{ at: T0 + 90_000, ms: 12_000 }, { at: T0 + 120_000, ms: 9_000 }], playing, T0 + 130_000)).toBe(true);
  });

  it("ignores sub-second waits and stalls outside the window", () => {
    const blips = Array.from({ length: 10 }, (_, i) => ({ at: T0 + 70_000 + i * 1000, ms: 400 }));
    expect(isChronicStalling(blips, playing, T0 + 90_000)).toBe(false);
    const old = Array.from({ length: 6 }, (_, i) => ({ at: T0 + i * 1000, ms: 2_000 }));
    expect(isChronicStalling(old, playing, T0 + STALL_WINDOW_MS + 10_000)).toBe(false);
  });

  it("does not judge a feed that has only just started, or never played", () => {
    const early = Array.from({ length: 6 }, (_, i) => ({ at: T0 + i * 5000, ms: 2_000 }));
    expect(isChronicStalling(early, playing, T0 + MIN_PLAY_BEFORE_JUDGING_MS - 1)).toBe(false);
    expect(isChronicStalling(early, null, T0 + 10 * 60_000)).toBe(false);
  });
});

describe("stallFailoverOrder", () => {
  const options = [
    { id: "sharks247", usable: true },
    { id: "abc7", usable: true },
    { id: "espn", usable: true },
    { id: "gamefeed", usable: true },
  ];
  const base = { options, gameFeedIds: ["gamefeed"], triedIds: [] as string[], switchesSoFar: 0, pickedId: null };

  it("moves a stalling guess the page chose, game feeds first", () => {
    expect(stallFailoverOrder({ ...base, currentId: "sharks247" })).toEqual(["gamefeed", "abc7", "espn"]);
  });

  it("moves a picked guess only to the game's own feeds", () => {
    expect(stallFailoverOrder({ ...base, currentId: "sharks247", pickedId: "sharks247" })).toEqual(["gamefeed"]);
    expect(stallFailoverOrder({ ...base, currentId: "sharks247", pickedId: "sharks247", gameFeedIds: [] })).toEqual([]);
  });

  it("never swaps a real game feed for a guess", () => {
    expect(stallFailoverOrder({ ...base, currentId: "gamefeed" })).toEqual([]);
    expect(stallFailoverOrder({ ...base, currentId: "gamefeed", gameFeedIds: ["gamefeed", "espn"] })).toEqual(["espn"]);
    expect(stallFailoverOrder({ ...base, currentId: "gamefeed", pickedId: "gamefeed", gameFeedIds: ["gamefeed", "espn"] })).toEqual(["espn"]);
  });

  it("never goes back to a feed tried this visit, nor to a full provider", () => {
    const opts = options.map((o) => (o.id === "abc7" ? { ...o, usable: false } : o));
    expect(stallFailoverOrder({ ...base, options: opts, currentId: "sharks247", triedIds: ["gamefeed"] })).toEqual(["espn"]);
  });

  it("puts a feed measured slow after the others in its tier", () => {
    const opts = options.map((o) => (o.id === "abc7" ? { ...o, slow: true } : o));
    expect(stallFailoverOrder({ ...base, options: opts, currentId: "sharks247" })).toEqual(["gamefeed", "espn", "abc7"]);
  });

  it("stops after MAX_STALL_SWITCHES", () => {
    expect(stallFailoverOrder({ ...base, currentId: "sharks247", switchesSoFar: MAX_STALL_SWITCHES })).toEqual([]);
  });
});

describe("shouldRescanForFeed", () => {
  const base = { selectedId: "espn", gameFeedIds: ["gamefeed"], held: false, searching: false, visible: true };
  it("looks again while a guess is on", () => {
    expect(shouldRescanForFeed(base)).toBe(true);
  });
  it("not while the game's own feed is on", () => {
    expect(shouldRescanForFeed({ ...base, selectedId: "gamefeed" })).toBe(false);
  });
  it("not while holding, searching, hidden, or with nothing selected", () => {
    expect(shouldRescanForFeed({ ...base, held: true })).toBe(false);
    expect(shouldRescanForFeed({ ...base, searching: true })).toBe(false);
    expect(shouldRescanForFeed({ ...base, visible: false })).toBe(false);
    expect(shouldRescanForFeed({ ...base, selectedId: null })).toBe(false);
  });
});

describe("feedStillNamesGame", () => {
  const fixture = { league: "NHL", awayTeam: "Buffalo Sabres", homeTeam: "San Jose Sharks", startUtc: "2026-10-28T02:30:00Z" };
  it("keeps a feed still named for the game", () => {
    expect(feedStillNamesGame("NHL | 08 - 10:30pm Sabres at Sharks", fixture)).toBe(true);
  });
  it("drops a stream the playlist refresh renamed to another game", () => {
    // Stream 96205, 2026-10-28.
    expect(feedStillNamesGame("NBA | 04 - 76ers vs. Pacers", fixture)).toBe(false);
  });
  it("drops an empty slot", () => {
    expect(feedStillNamesGame("NHL | 08 -", fixture)).toBe(false);
  });
});

describe("resumeAction", () => {
  const base = { hiddenForMs: 30_000, advancedWhileHiddenSec: 0, failedWhileHidden: false, restoredFromCache: false, hadPicture: true };
  it("re-tunes at once when the tune died while hidden or the page came from the cache", () => {
    expect(resumeAction({ ...base, failedWhileHidden: true })).toBe("retune");
    expect(resumeAction({ ...base, restoredFromCache: true })).toBe("retune");
  });
  it("re-tunes at once after a lock long enough for Jellyfin to have killed the session", () => {
    expect(resumeAction({ ...base, hiddenForMs: SESSION_LOST_HIDDEN_MS + 1 })).toBe("retune");
  });
  it("checks after a short lock", () => {
    expect(resumeAction(base)).toBe("check");
  });
  it("leaves alone a stream that played on in the background, or never started", () => {
    expect(resumeAction({ ...base, hiddenForMs: 120_000, advancedWhileHiddenSec: 118 })).toBe("none");
    expect(resumeAction({ ...base, hadPicture: false })).toBe("none");
  });
});
