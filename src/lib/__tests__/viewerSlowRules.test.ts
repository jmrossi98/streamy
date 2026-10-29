import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../liveChannelStateRules";
import { SPEED_TRUST_MS } from "../liveChannelRules";
import {
  rankWithViewers,
  stallRuns,
  viewerSlowChannels,
  viewerSlowRank,
  WEAK_TRUST_MS,
} from "../viewerSlowRules";

const MIN = 60_000;
const T0 = 1_800_000_000_000;

function ev(sessionId: string, userName: string, at: number, kind: string, channel: string, ms: number | null = null): LiveEvent {
  return { sessionId, userName, at: T0 + at, kind, media: `Live: ${channel}`, detail: null, ms };
}

/** A tune from `from` to `to` minutes, stalling 3 s every `every` minutes in [stallFrom, stallTo). */
function watch(
  session: string,
  user: string,
  channel: string,
  from: number,
  to: number | null,
  stall?: { every: number; stallFrom?: number; stallTo?: number }
): LiveEvent[] {
  const out = [ev(session, user, from * MIN, "start", channel), ev(session, user, from * MIN + 3000, "playing", channel)];
  if (stall) {
    const end = stall.stallTo ?? to ?? from + 60;
    for (let m = stall.stallFrom ?? from + 1; m < end; m += stall.every) out.push(ev(session, user, m * MIN, "stall", channel, 3000));
  }
  if (to != null) out.push(ev(session, user, to * MIN, "stop", channel));
  return out;
}

const SHARKS = "NHL SAN JOSE SHARKS";
const NEWS = "SPECTRUM NEWS";

describe("stallRuns", () => {
  it("finds a tab's stalling run on a channel, not the odd stall", () => {
    const runs = stallRuns([...watch("a", "Ana", SHARKS, 0, 40, { every: 1, stallFrom: 5, stallTo: 20 }), ...watch("b", "Bo", NEWS, 0, 40, { every: 15 })]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ key: "nhlsanjosesharks", sessionId: "a" });
  });
});

describe("viewerSlowChannels", () => {
  it("Ana: stalled on the Sharks channel while Spectrum News played fine in the same tab -- corroborated, held for the trust window", () => {
    const events = [
      ...watch("a", "Ana", SHARKS, 0, 30, { every: 1 }),
      ...watch("a", "Ana", NEWS, 31, 50),
    ];
    const slow = viewerSlowChannels(events, { now: T0 + 60 * MIN });
    const s = slow.get("nhlsanjosesharks")!;
    expect(s).toMatchObject({ corroborated: true, people: ["Ana"] });
    expect(s.until).toBe(s.lastStallAt + SPEED_TRUST_MS);
    expect(slow.has("spectrumnews")).toBe(false);
    // Still counts at two hours, gone after the trust window.
    expect(viewerSlowChannels(events, { now: T0 + 120 * MIN }).has("nhlsanjosesharks")).toBe(true);
    expect(viewerSlowChannels(events, { now: s.lastStallAt + SPEED_TRUST_MS + 1 }).size).toBe(0);
  });

  it("one viewer, nothing to compare with: counts only for the weak window", () => {
    const events = watch("a", "Ana", SHARKS, 0, 30, { every: 1 });
    const s = viewerSlowChannels(events, { now: T0 + 40 * MIN }).get("nhlsanjosesharks")!;
    expect(s.corroborated).toBe(false);
    expect(s.until).toBe(s.lastStallAt + WEAK_TRUST_MS);
    expect(viewerSlowChannels(events, { now: s.lastStallAt + WEAK_TRUST_MS + 1 }).size).toBe(0);
  });

  it("one viewer stalling on every channel is their connection, not the feed", () => {
    const events = [...watch("a", "Ana", SHARKS, 0, 20, { every: 1 }), ...watch("a", "Ana", NEWS, 21, 40, { every: 1 })];
    expect(viewerSlowChannels(events, { now: T0 + 45 * MIN }).size).toBe(0);
  });

  it("two people stalling on one channel is stronger, and ranks lower than one", () => {
    const events = [...watch("a", "Ana", SHARKS, 0, 20, { every: 1 }), ...watch("b", "Bo", SHARKS, 5, 25, { every: 1 })];
    const s = viewerSlowChannels(events, { now: T0 + 30 * MIN }).get("nhlsanjosesharks")!;
    expect(s).toMatchObject({ corroborated: true, runs: 2 });
    expect(s.people.sort()).toEqual(["Ana", "Bo"]);
    expect(s.rank).toBeGreaterThan(viewerSlowRank(1, true));
  });

  it("is cleared by a checker reading at full speed after the last stall, not by a borderline one", () => {
    const events = watch("a", "Ana", SHARKS, 0, 30, { every: 1 });
    const now = T0 + 40 * MIN;
    const after = T0 + 35 * MIN;
    expect(viewerSlowChannels(events, { now, checker: new Map([["nhlsanjosesharks", { speed: 1.02, at: after }]]) }).size).toBe(0);
    expect(viewerSlowChannels(events, { now, checker: new Map([["nhlsanjosesharks", { speed: 0.95, at: after }]]) }).size).toBe(1);
    // A good reading from before the stalling says nothing.
    expect(viewerSlowChannels(events, { now, checker: new Map([["nhlsanjosesharks", { speed: 1.1, at: T0 }]]) }).size).toBe(1);
  });

  it("is cleared by someone playing it smoothly for ten minutes after the last stall", () => {
    const stalled = watch("a", "Ana", SHARKS, 0, 30, { every: 1 });
    expect(viewerSlowChannels([...stalled, ...watch("b", "Bo", SHARKS, 32, 39)], { now: T0 + 50 * MIN }).size).toBe(1);
    expect(viewerSlowChannels([...stalled, ...watch("b", "Bo", SHARKS, 32, 45)], { now: T0 + 50 * MIN }).size).toBe(0);
  });

  it("a tab that closed without a stop is not taken as smooth playback past its last heartbeat", () => {
    // Stalls through minute 29, then the phone tab vanishes with no stop event.
    const events = watch("a", "Ana", SHARKS, 0, null, { every: 1, stallTo: 30 });
    const now = T0 + 60 * MIN;
    expect(viewerSlowChannels(events, { now }).size).toBe(0); // assumed playing on: cleared
    expect(viewerSlowChannels(events, { now, lastSeen: new Map([["a", T0 + 30 * MIN]]) }).size).toBe(1);
  });
});

describe("rankWithViewers", () => {
  it("takes the worse of the checker's rank and the viewers'", () => {
    const slow = { rank: 2.07 } as Parameters<typeof rankWithViewers>[1];
    expect(rankWithViewers(0, slow)).toBe(2.07);
    expect(rankWithViewers(undefined, slow)).toBe(2.07);
    expect(rankWithViewers(2.27, slow)).toBe(2.27);
    expect(rankWithViewers(0, undefined)).toBe(0);
  });
});
