import { describe, it, expect } from "vitest";
import { deviceLabel, parsePresence, presenceOf, sessionHealth } from "../viewerActivityRules";

const NOW = 1_800_000_000_000;

describe("parsePresence", () => {
  it("keeps a valid heartbeat", () => {
    const p = parsePresence(
      {
        sessionId: "abcDEF123_-x",
        path: "/live/game/NHL:1",
        playing: { kind: "live", title: "NHL | 07 - 7pm Sharks at Red Wings", state: "playing", since: NOW - 1000 },
        events: [{ kind: "playing", media: "Live: Sharks", ms: 8700, at: NOW - 500 }],
      },
      NOW
    );
    expect(p?.playing?.state).toBe("playing");
    expect(p?.events).toEqual([{ kind: "playing", media: "Live: Sharks", detail: null, ms: 8700, at: NOW - 500 }]);
  });

  it("rejects a missing or malformed session id", () => {
    expect(parsePresence({ path: "/" }, NOW)).toBeNull();
    expect(parsePresence({ sessionId: "<script>" }, NOW)).toBeNull();
  });

  it("drops unknown kinds and states, and pins clocks to now", () => {
    const p = parsePresence(
      {
        sessionId: "abcdefgh",
        playing: { kind: "live", title: "X", state: "hacked", since: NOW },
        events: [
          { kind: "explode", media: "X" },
          { kind: "error", media: "X", detail: "boom", at: NOW + 60_000 },
        ],
      },
      NOW
    );
    expect(p?.playing).toBeNull();
    expect(p?.events).toHaveLength(1);
    expect(p?.events[0].at).toBe(NOW);
  });
});

describe("deviceLabel", () => {
  it("names tonight's two devices", () => {
    expect(
      deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1")
    ).toBe("iPhone · Safari");
    expect(
      deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")
    ).toBe("Windows · Chrome");
  });
});

describe("presenceOf", () => {
  it("online, idle, offline", () => {
    expect(presenceOf(NOW - 20_000, NOW)).toBe("online");
    expect(presenceOf(NOW - 3 * 60_000, NOW)).toBe("idle");
    expect(presenceOf(NOW - 10 * 60_000, NOW)).toBe("offline");
  });
});

describe("sessionHealth", () => {
  const ev = (kind: string, at: number, ms: number | null = null, detail: string | null = null) => ({ kind, at, ms, detail });

  it("smooth: started, played, one short stall", () => {
    const h = sessionHealth([ev("start", 1), ev("playing", 2, 8700), ev("stall", 3, 1200), ev("stop", 4)]);
    expect(h.verdict).toBe("smooth");
    expect(h.medianStartMs).toBe(8700);
  });

  it("failing: the iPhone loop -- starts that never reached a picture", () => {
    const h = sessionHealth([ev("start", 1), ev("retry", 2), ev("start", 3), ev("retry", 4), ev("start", 5), ev("stop", 6)]);
    expect(h.verdict).toBe("failing");
    expect(h.errors).toBe(3);
    expect(h.retries).toBe(2);
  });

  it("failing on an error, and remembers it", () => {
    const h = sessionHealth([ev("start", 1), ev("error", 2, null, "This channel didn’t start.")]);
    expect(h.verdict).toBe("failing");
    expect(h.lastError).toBe("This channel didn’t start.");
  });

  it("ignores waits nobody could see", () => {
    // 2026-10-18, Clone High: smooth, but logged 3ms and 90ms waits.
    const h = sessionHealth([ev("start", 1), ev("playing", 2, 59), ev("stall", 3, 3), ev("stall", 4, 90), ev("stall", 5, 400)]);
    expect(h.verdict).toBe("smooth");
    expect(h.stalls).toBe(0);
  });

  it("rough: lots of buffering", () => {
    const h = sessionHealth([ev("start", 1), ev("playing", 2, 4000), ev("stall", 3, 6000), ev("stall", 4, 6000)]);
    expect(h.verdict).toBe("rough");
  });

  it("none: just browsing", () => {
    expect(sessionHealth([]).verdict).toBe("none");
  });
});
