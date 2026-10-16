import { describe, expect, it } from "vitest";
import {
  POST_GAME_GRACE_MS,
  ROLLED_OFF_MIN_AGE_MS,
  decideGameChannel,
  type GameChannelInputs,
  type RecordedGameChannel,
} from "../gameChannelCleanupRules";

const now = new Date("2026-10-16T05:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const row = (over: Partial<RecordedGameChannel> = {}): RecordedGameChannel => ({
  channelId: 42,
  fixtureId: "401802001",
  createdAt: ago(3 * 60 * 60_000),
  endedSeenAt: null,
  ...over,
});

const inputs = (over: Partial<GameChannelInputs> = {}): GameChannelInputs => ({
  fixtureState: "post",
  scheduleAvailable: true,
  channelExists: true,
  inUse: false,
  now,
  ...over,
});

describe("cleaning up channels added for one game", () => {
  it("leaves a game that hasn't started or is still on alone", () => {
    expect(decideGameChannel(row(), inputs({ fixtureState: "pre" })).action).toBe("keep");
    expect(decideGameChannel(row(), inputs({ fixtureState: "in" })).action).toBe("keep");
  });

  it("starts the grace period the first time it sees the game finished", () => {
    expect(decideGameChannel(row(), inputs()).action).toBe("mark-ended");
  });

  it("keeps a finished game's channel inside the 30-minute grace", () => {
    const r = row({ endedSeenAt: ago(POST_GAME_GRACE_MS - 60_000) });
    expect(decideGameChannel(r, inputs()).action).toBe("keep");
  });

  it("removes it once the game has been over for 30 minutes", () => {
    const r = row({ endedSeenAt: ago(POST_GAME_GRACE_MS) });
    expect(decideGameChannel(r, inputs()).action).toBe("remove");
  });

  it("never removes a channel someone is watching", () => {
    const r = row({ endedSeenAt: ago(2 * POST_GAME_GRACE_MS) });
    expect(decideGameChannel(r, inputs({ inUse: true })).action).toBe("keep");
  });

  it("treats not knowing who is watching as someone watching", () => {
    const r = row({ endedSeenAt: ago(2 * POST_GAME_GRACE_MS) });
    expect(decideGameChannel(r, inputs({ inUse: null })).action).toBe("keep");
  });

  it("still starts the grace period while someone is watching", () => {
    // Otherwise a game watched to the final whistle would only start its
    // 30 minutes after the viewer left.
    expect(decideGameChannel(row(), inputs({ inUse: true })).action).toBe("mark-ended");
  });

  it("removes an old channel whose fixture rolled off the schedule at midnight", () => {
    const r = row({ createdAt: ago(ROLLED_OFF_MIN_AGE_MS) });
    expect(decideGameChannel(r, inputs({ fixtureState: null })).action).toBe("remove");
  });

  it("keeps a recent channel whose fixture isn't in the schedule", () => {
    const r = row({ createdAt: ago(ROLLED_OFF_MIN_AGE_MS - 60_000) });
    expect(decideGameChannel(r, inputs({ fixtureState: null })).action).toBe("keep");
  });

  it("doesn't read an unreachable schedule as every game having ended", () => {
    const r = row({ createdAt: ago(2 * ROLLED_OFF_MIN_AGE_MS) });
    expect(
      decideGameChannel(r, inputs({ fixtureState: null, scheduleAvailable: false })).action
    ).toBe("keep");
  });

  it("trusts an earlier 'finished' sighting after the schedule rolls over", () => {
    const r = row({ createdAt: ago(60 * 60_000), endedSeenAt: ago(POST_GAME_GRACE_MS) });
    expect(
      decideGameChannel(r, inputs({ fixtureState: null, scheduleAvailable: false })).action
    ).toBe("remove");
  });

  it("forgets the record of a channel already removed by hand", () => {
    expect(decideGameChannel(row(), inputs({ fixtureState: "in", channelExists: false })).action).toBe(
      "forget"
    );
  });

  it("waits when Dispatcharr can't be listed", () => {
    const r = row({ endedSeenAt: ago(2 * POST_GAME_GRACE_MS) });
    expect(decideGameChannel(r, inputs({ channelExists: null })).action).toBe("keep");
  });
});
