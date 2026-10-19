import { describe, it, expect } from "vitest";
import { FORGET_AFTER_MS, PING_EVERY_MS, keepalivePlan, playSessionOf } from "../playbackKeepaliveRules";

describe("keepalivePlan", () => {
  const now = 1_000_000;

  it("pings every session fetched from recently", () => {
    const seen = new Map([
      ["a", now - 1_000],
      ["b", now - FORGET_AFTER_MS],
    ]);
    expect(keepalivePlan(seen, now)).toEqual({ ping: ["a", "b"], drop: [] });
  });

  it("drops a session nobody has fetched from for too long", () => {
    const seen = new Map([
      ["a", now - 1_000],
      ["gone", now - FORGET_AFTER_MS - 1],
    ]);
    expect(keepalivePlan(seen, now)).toEqual({ ping: ["a"], drop: ["gone"] });
  });

  it("has nothing to do for no sessions", () => {
    expect(keepalivePlan(new Map(), now)).toEqual({ ping: [], drop: [] });
  });

  it("pings well inside Jellyfin's one-minute timeout", () => {
    expect(PING_EVERY_MS * 2).toBeLessThanOrEqual(60_000);
  });
});

describe("playSessionOf", () => {
  it("reads our id on the master request", () => {
    expect(playSessionOf(new URLSearchParams("session=abc&t=12"))).toBe("abc");
  });

  it("reads Jellyfin's echo on variant playlists and segments", () => {
    expect(playSessionOf(new URLSearchParams("mediaSourceId=x&PlaySessionId=abc"))).toBe("abc");
    expect(playSessionOf(new URLSearchParams("playSessionId=abc"))).toBe("abc");
  });

  it("is null when the request names no session", () => {
    expect(playSessionOf(new URLSearchParams("mediaSourceId=x"))).toBeNull();
  });
});
