import { describe, it, expect } from "vitest";
import {
  RETRY_AFTER_MS,
  channelKey,
  channelWorkingStates,
  isNotWorking,
  isBusyFailure,
  isOutageFailure,
  streamsPlayingDuring,
  liveTunes,
  snapshotReading,
  withWorkingState,
  type LiveEvent,
} from "../liveChannelStateRules";

const T0 = Date.parse("2026-10-18T20:25:00Z");
const MIN = 60_000;

function ev(sessionId: string, at: number, kind: string, channel: string, detail: string | null = null, ms: number | null = null, userName = "jaker"): LiveEvent {
  return { sessionId, userName, at, kind, media: `Live: ${channel}`, detail, ms };
}

/** One tune the way LivePlayer reports it: N tries, each retried, none reaching a picture. */
function failedTune(sessionId: string, at: number, channel: string, tries = 4, userName = "jaker"): LiveEvent[] {
  const out: LiveEvent[] = [];
  let t = at;
  for (let i = 0; i < tries; i++) {
    out.push(ev(sessionId, t, "start", channel, null, null, userName));
    if (i === 0) out.push(ev(sessionId, t, "error", channel, "Playback failed.", null, userName));
    if (i < tries - 1) out.push(ev(sessionId, t + 14_000, "retry", channel, "Playback failed.", null, userName));
    out.push(ev(sessionId, t + 18_000, "stop", channel, "stopped before the picture started", 18_000, userName));
    t += 18_002;
  }
  return out;
}

function playedTune(sessionId: string, at: number, channel: string, userName = "jaker"): LiveEvent[] {
  return [ev(sessionId, at, "start", channel, null, null, userName), ev(sessionId, at + 5000, "playing", channel, null, 5000, userName)];
}

describe("liveTunes", () => {
  it("folds the player's own retries into one failed tune", () => {
    // 2026-10-18: BEIN SPORTS HD, four tries in 80 s, never a picture.
    const tunes = liveTunes(failedTune("s1", T0, "BEIN SPORTS HD"), T0 + 10 * MIN);
    expect(tunes).toHaveLength(1);
    expect(tunes[0]).toMatchObject({ outcome: "failed", tries: 4, key: "beinsportshd", lastError: "Playback failed." });
  });

  it("calls a tune that recovered on a retry played", () => {
    // 2026-10-24: NFL Network failed once, re-tuned and played 5 s later.
    const events = [
      ev("s1", T0, "start", "NFL - NFL NETWORK HD"),
      ev("s1", T0 + 9000, "retry", "NFL - NFL NETWORK HD", "Playback failed."),
      ev("s1", T0 + 12_000, "stop", "NFL - NFL NETWORK HD", "stopped before the picture started", 12_000),
      ev("s1", T0 + 12_004, "start", "NFL - NFL NETWORK HD"),
      ev("s1", T0 + 16_000, "playing", "NFL - NFL NETWORK HD", null, 4000),
    ];
    const tunes = liveTunes(events, T0 + 10 * MIN);
    expect(tunes).toHaveLength(1);
    expect(tunes[0]).toMatchObject({ outcome: "played", tries: 2, pictureAt: T0 + 16_000 });
  });

  it("ignores flicking past a channel", () => {
    const events = [ev("s1", T0, "start", "CNN"), ev("s1", T0 + 2000, "stop", "CNN", "stopped before the picture started", 2000)];
    expect(liveTunes(events, T0 + MIN)).toEqual([]);
  });

  it("leaves a try still in flight pending, and drops one from a tab that died", () => {
    const events = [ev("s1", T0, "start", "CNN")];
    expect(liveTunes(events, T0 + 30_000)[0].outcome).toBe("pending");
    expect(liveTunes(events, T0 + 10 * MIN)).toEqual([]);
  });

  it("counts an error with no stop as a failed try once the next start arrives", () => {
    const events = [
      ev("s1", T0, "start", "X"),
      ev("s1", T0 + 1000, "error", "X", "This channel didn’t start."),
      ev("s1", T0 + 3000, "start", "X"),
      ev("s1", T0 + 25_000, "stop", "X", "stopped before the picture started", 22_000),
    ];
    const [tune] = liveTunes(events, T0 + 10 * MIN);
    expect(tune).toMatchObject({ outcome: "failed", tries: 2 });
  });

  it("ignores anything that is not live", () => {
    expect(liveTunes([{ ...ev("s1", T0, "start", "x"), media: "Frieren S1E29" }], T0)).toEqual([]);
  });
});

describe("isOutageFailure", () => {
  it("treats a run of channels all failing with nothing playing as an outage", () => {
    // 2026-10-18 20:25-20:32: seven channels failed in a row in one tab,
    // ABC 7 BUFFALO among them -- it had played fine the night before.
    const events = [
      ...failedTune("s1", T0, "ESPN DEPORTES"),
      ...failedTune("s1", T0 + 2 * MIN, "ABC 7 BUFFALO NY (WKBW)"),
      ...failedTune("s1", T0 + 4 * MIN, "BEIN SPORTS HD"),
    ];
    const tunes = liveTunes(events, T0 + 30 * MIN);
    expect(tunes.every((t) => isOutageFailure(t, tunes))).toBe(true);
  });

  it("does not when something else played in the window", () => {
    const events = [
      ...failedTune("s1", T0, "ESPN DEPORTES"),
      ...failedTune("s1", T0 + 2 * MIN, "BEIN SPORTS 2 HD"),
      ...failedTune("s1", T0 + 4 * MIN, "BEIN SPORTS HD"),
      ...playedTune("s2", T0 + 5 * MIN, "FOX 29 BUFFALO NY (WUTV)", "mom"),
    ];
    const tunes = liveTunes(events, T0 + 30 * MIN);
    expect(tunes.filter((t) => t.outcome === "failed").some((t) => isOutageFailure(t, tunes))).toBe(false);
  });
});

describe("isBusyFailure", () => {
  it("does not hold a failure against a channel while other tabs held the lines", () => {
    // 2026-10-18 20:25-20:32: the BEIN/ESPN DEPORTES/SKY F1 failures happened
    // while three other tabs were watching CBS 13, FOX 31 and CBS 8.
    const events = [
      ...playedTune("other1", T0 - 20 * MIN, "CBS 13 BALTIMORE MD (WJZ)", "mom"),
      ...playedTune("other2", T0 - 4 * MIN, "FOX 31 ROCHESTER NY (WUHF)", "dad"),
      ...failedTune("s1", T0, "BEIN SPORTS HD"),
    ];
    const tunes = liveTunes(events, T0 + 10 * MIN);
    const bein = tunes.find((t) => t.key === "beinsportshd")!;
    expect(streamsPlayingDuring(bein, tunes)).toBe(2);
    expect(isBusyFailure(bein, tunes)).toBe(true);
  });

  it("stops counting a stream once it stopped", () => {
    const events = [
      ...playedTune("other1", T0 - 20 * MIN, "A", "mom"),
      ev("other1", T0 - 10 * MIN, "stop", "A", null, 600_000, "mom"),
      ...playedTune("other2", T0 - 4 * MIN, "B", "dad"),
      ...failedTune("s1", T0, "X"),
    ];
    const tunes = liveTunes(events, T0 + 10 * MIN);
    expect(isBusyFailure(tunes.find((t) => t.key === "x")!, tunes)).toBe(false);
  });

  it("trusts the player's own 503 wording", () => {
    const events = [
      ev("s1", T0, "start", "X"),
      ev("s1", T0 + 1000, "error", "X", "This channel couldn’t be tuned — the provider’s lines are all in use."),
      ev("s1", T0 + 2000, "stop", "X", "stopped before the picture started", 2000),
    ];
    const tunes = liveTunes(events, T0 + 10 * MIN);
    expect(isBusyFailure(tunes[0], tunes)).toBe(true);
  });

  it("keeps all of 2026-10-18's line-starved failures from hiding anything", () => {
    const events = [
      ...playedTune("other1", T0 - 20 * MIN, "CBS 13", "mom"),
      ...playedTune("other2", T0 - 4 * MIN, "FOX 31", "dad"),
      ...failedTune("s1", T0, "BEIN SPORTS HD"),
      ...failedTune("s1", T0 + 30 * MIN, "BEIN SPORTS HD"),
    ];
    const now = T0 + 60 * MIN;
    expect(channelWorkingStates({ tunes: liveTunes(events, now), now }).get("beinsportshd")).toBeUndefined();
  });
});

describe("channelWorkingStates", () => {
  const now = T0 + 2 * 60 * MIN;

  it("leaves one failed tune alone: a hiccup is not a dead channel", () => {
    const states = channelWorkingStates({ tunes: liveTunes(failedTune("s1", T0, "BEIN SPORTS HD"), now), now });
    expect(states.get("beinsportshd")?.state).toBe("working");
  });

  it("hides a channel after two separate failed tunes", () => {
    const events = [...failedTune("s1", T0, "BEIN SPORTS HD"), ...failedTune("s2", T0 + 40 * MIN, "BEIN SPORTS HD", 2, "mom")];
    const s = channelWorkingStates({ tunes: liveTunes(events, now), now }).get("beinsportshd");
    expect(s).toMatchObject({ state: "not-working", failedTunes: 2, people: ["jaker", "mom"] });
    expect(s?.retryAt).toBe(s!.lastFailureAt! + RETRY_AFTER_MS);
  });

  it("does not count two tunes moments apart in one tab twice", () => {
    // Re-tuning by hand right after the player gave up is the same attempt.
    const events = [...failedTune("s1", T0, "X", 2), ...failedTune("s1", T0 + 5 * MIN, "X", 2)];
    expect(channelWorkingStates({ tunes: liveTunes(events, now), now }).get("x")?.state).toBe("working");
  });

  it("counts the same tab again once enough time has passed", () => {
    const events = [...failedTune("s1", T0, "X", 2), ...failedTune("s1", T0 + 30 * MIN, "X", 2)];
    expect(channelWorkingStates({ tunes: liveTunes(events, now), now }).get("x")?.state).toBe("not-working");
  });

  it("does not hide channels for an outage", () => {
    const events = [
      ...failedTune("s1", T0, "A"),
      ...failedTune("s1", T0 + 2 * MIN, "B"),
      ...failedTune("s1", T0 + 4 * MIN, "C"),
      ...failedTune("s1", T0 + 60 * MIN, "A"),
      ...failedTune("s1", T0 + 62 * MIN, "B"),
      ...failedTune("s1", T0 + 64 * MIN, "C"),
    ];
    const states = channelWorkingStates({ tunes: liveTunes(events, now), now });
    expect([...states.values()].filter((s) => s.state !== "working")).toEqual([]);
  });

  it("clears the moment anyone gets a picture", () => {
    const events = [
      ...failedTune("s1", T0, "X"),
      ...failedTune("s2", T0 + 20 * MIN, "X"),
      ...playedTune("s3", T0 + 50 * MIN, "X"),
    ];
    expect(channelWorkingStates({ tunes: liveTunes(events, now), now }).has("x")).toBe(false);
  });

  it("offers it again as retrying after the cool-off, and re-hides on the next failure", () => {
    const events = [...failedTune("s1", T0, "X"), ...failedTune("s2", T0 + 20 * MIN, "X")];
    const later = T0 + 30 * MIN + RETRY_AFTER_MS;
    expect(channelWorkingStates({ tunes: liveTunes(events, later), now: later }).get("x")?.state).toBe("retrying");

    const retried = [...events, ...failedTune("s3", later + MIN, "X", 2)];
    const after = later + 10 * MIN;
    expect(channelWorkingStates({ tunes: liveTunes(retried, after), now: after }).get("x")?.state).toBe("not-working");
  });

  it("forgets evidence from before an admin put it back", () => {
    const events = [...failedTune("s1", T0, "X"), ...failedTune("s2", T0 + 20 * MIN, "X")];
    const clearedAt = new Map([["x", T0 + 30 * MIN]]);
    expect(channelWorkingStates({ tunes: liveTunes(events, now), clearedAt, now }).has("x")).toBe(false);
  });

  it("comes back when the checker opens it, but not from a passive reading", () => {
    const events = [...failedTune("s1", T0, "X"), ...failedTune("s2", T0 + 20 * MIN, "X")];
    const tunes = liveTunes(events, now);
    const sampled = new Map([["x", { playable: true, checkedAt: T0 + 60 * MIN }]]);
    expect(channelWorkingStates({ tunes, snapshot: sampled, now }).has("x")).toBe(false);
    // 2026-10-18: SKY SPORTS F1 HD read "being watched", playable, two
    // seconds after the browser gave up on it.
    const passive = new Map([["x", { playable: true, checkedAt: T0 + 60 * MIN, passive: true }]]);
    expect(channelWorkingStates({ tunes, snapshot: passive, now }).get("x")?.state).toBe("not-working");
  });
});

describe("snapshotReading", () => {
  it("marks the checker's watched-stream readings passive", () => {
    expect(snapshotReading({ playable: true, detail: "being watched", checkedAt: "2026-10-18T20:32:04+00:00" })).toEqual({
      playable: true,
      checkedAt: Date.parse("2026-10-18T20:32:04Z"),
      passive: true,
    });
    expect(snapshotReading({ playable: true, detail: "1280x720" }).passive).toBe(false);
  });
});

describe("withWorkingState", () => {
  const base = { state: "live" as const, detail: "Streaming" };
  const working = (state: "working" | "not-working" | "retrying") => ({
    key: "x",
    channel: "X",
    state,
    hiddenAt: 1,
    lastFailureAt: 1,
    failedTunes: 2,
    people: [],
    lastError: null,
    retryAt: 2,
  });

  it("hides a channel that does not work", () => {
    const v = withWorkingState(base, working("not-working"));
    expect(v).toMatchObject({ state: "down", hidden: true, notWorking: "hidden", detail: "Not working right now" });
    expect(isNotWorking(v)).toBe(true);
  });

  it("offers a retrying channel, badged", () => {
    expect(withWorkingState(base, working("retrying"))).toEqual({ ...base, notWorking: "retrying" });
  });

  it("treats the checker's own dead verdict as not working, even over a retry", () => {
    const dead = { state: "down" as const, detail: "Not responding", hidden: true };
    expect(withWorkingState(dead, working("retrying")).notWorking).toBe("hidden");
    expect(withWorkingState(dead, undefined).notWorking).toBe("hidden");
  });

  it("leaves everything else alone", () => {
    expect(withWorkingState(base, undefined)).toBe(base);
    const over = { state: "filler" as const, detail: "Game over", hidden: true };
    expect(withWorkingState(over, undefined)).toBe(over);
  });
});

describe("channelKey", () => {
  it("strips decoration", () => {
    expect(channelKey("NBA: NEW YORK KNICKS (NYK) ᴴᴰ")).toBe("nbanewyorkknicksnyk");
  });
});
