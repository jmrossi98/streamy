import { describe, expect, it } from "vitest";
import {
  CHOICE_TTL_DAYS,
  resolveStoredChoice,
  staleChoiceCutoff,
} from "../gameChannelChoice";

const options = [
  { id: "1", name: "ESPN" },
  { id: "2", name: "TNT" },
  { id: "3", name: "ABC" },
];

describe("resolveStoredChoice", () => {
  it("has nothing to say without a stored pick", () => {
    expect(resolveStoredChoice(options, null)).toBeNull();
  });

  it("finds the pick by id", () => {
    expect(resolveStoredChoice(options, { channelId: "2", name: "TNT" })?.id).toBe("2");
  });

  it("trusts the id over a stale name snapshot", () => {
    // The channel was renamed since the pick; the id still points at it.
    expect(
      resolveStoredChoice(options, { channelId: "2", name: "Turner Network" })?.id
    ).toBe("2");
  });

  it("falls back to the name when the tuner has renumbered", () => {
    expect(
      resolveStoredChoice(options, { channelId: "gone-999", name: "ABC" })?.id
    ).toBe("3");
  });

  it("matches a renamed case, since providers re-case their listings", () => {
    expect(
      resolveStoredChoice(options, { channelId: "gone", name: "  espn hd  " })
    ).toBeNull();
    expect(
      resolveStoredChoice(options, { channelId: "gone", name: "  eSpN " })?.id
    ).toBe("1");
  });

  it("returns null when the channel is gone entirely", () => {
    // Deliberately not the first option: falling back to a guess here would
    // look identical to a remembered pick, which is the bug being avoided.
    expect(
      resolveStoredChoice(options, { channelId: "gone", name: "Sky Sports" })
    ).toBeNull();
  });

  it("does not match on an empty name when the id is gone", () => {
    expect(resolveStoredChoice(options, { channelId: "gone", name: "   " })).toBeNull();
  });

  it("has nothing to resolve against an empty lineup", () => {
    expect(resolveStoredChoice([], { channelId: "1", name: "ESPN" })).toBeNull();
  });
});

describe("staleChoiceCutoff", () => {
  it("is the TTL behind the given moment", () => {
    const now = new Date("2026-09-21T00:00:00.000Z");
    expect(staleChoiceCutoff(now).toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect(CHOICE_TTL_DAYS).toBe(14);
  });
});
