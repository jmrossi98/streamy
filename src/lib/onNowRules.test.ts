import { describe, expect, it } from "vitest";
import type { LiveConnection } from "./dispatcharr";
import { buildOnNow, onNowAlerts, streamHealth } from "./onNowRules";
import type { DescribedSession } from "./streamingHeadroomRules";
import type { ViewerSessionView } from "./viewerActivity";

const NOW = 1_800_000_000_000;

const roku: DescribedSession = {
  id: "jf1",
  user: "jaker",
  client: "Jellyfin Roku",
  device: "Living room",
  title: "Live: NHL BUFFALO SABRES",
  channel: "NHL BUFFALO SABRES",
  where: "lan",
  ip: "192.168.0.233",
  method: "transcode",
  mbps: 10.3,
  paused: false,
  reasons: ["DirectPlayError"],
  output: "1920x1080 h264",
  fps: 33,
  hwAccel: "nvenc",
  checkInAgeS: 2,
};

const feed: LiveConnection = {
  channelName: "NHL Buffalo Sabres",
  streamName: "trex 1",
  lineId: 3,
  resolution: "1920x1080",
  speed: 1.02,
  state: "active",
  uptimeSeconds: 600,
  kbps: 9800,
  clients: 1,
};

function tab(over: Partial<ViewerSessionView> = {}): ViewerSessionView {
  return {
    id: "t1",
    userName: "Jaker",
    device: "Windows · Chrome",
    ip: "73.1.2.3",
    location: "Penn Yan, US",
    path: "/live/channel/1",
    presence: "online",
    startedAt: NOW - 600_000,
    lastSeenAt: NOW - 5_000,
    playing: { kind: "live", title: "NHL BUFFALO SABRES", state: "playing", since: NOW - 300_000 },
    health: { verdict: "none", starts: 1, medianStartMs: 4000, stalls: 0, stallMs: 0, errors: 0, retries: 0, lastError: null },
    events: [],
    ...over,
  };
}

describe("buildOnNow", () => {
  it("shows a Roku at home that no Streamy tab knows about, with its provider feed", () => {
    const out = buildOnNow({ sessions: [], jellyfin: [roku], streams: [], connections: [feed], now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ via: "jellyfin", userName: "jaker", place: "at home", device: "Jellyfin Roku · Living room" });
    expect(out[0].playing).toMatchObject({ kind: "live", title: "Live: NHL BUFFALO SABRES", state: "playing" });
    expect(out[0].feed?.channelName).toBe("NHL Buffalo Sabres");
    expect(out[0].health).toMatchObject({ level: "ok", label: "smooth" });
  });

  it("merges a Streamy tab with Jellyfin's view of it and the bytes Streamy is piping", () => {
    const viaStreamy: DescribedSession = { ...roku, id: "jf2", where: "tailnet", ip: "100.84.77.56", client: "Streamy", device: "Chrome" };
    const out = buildOnNow({
      sessions: [tab()],
      jellyfin: [viaStreamy],
      streams: [{ user: "Jaker", kind: "live", ref: "1", mbps: 8.2, bytes: 3e8, since: NOW - 300_000, lastSeenAt: NOW }],
      connections: [feed],
      now: NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ via: "streamy", jellyfin: { id: "jf2" }, pipe: { mbps: 8.2 } });
    expect(out[0].feed).not.toBeNull();
  });

  it("flags a live channel Jellyfin is serving with no provider feed behind it", () => {
    const out = buildOnNow({ sessions: [], jellyfin: [roku], streams: [], connections: [], now: NOW });
    expect(out[0].health.level).toBe("bad");
    expect(out[0].health.notes[0]).toMatch(/no provider feed/);
    expect(onNowAlerts(out)).toEqual(["jaker: Live: NHL BUFFALO SABRES — no provider feed open for this channel"]);
  });

  it("says nothing about a missing feed when Dispatcharr couldn't be asked", () => {
    const out = buildOnNow({ sessions: [], jellyfin: [roku], streams: [], connections: null, now: NOW });
    expect(out[0].health.level).toBe("ok");
  });

  it("puts failing streams first, then players, then browsers", () => {
    const browsing = tab({ id: "t0", userName: "Al", playing: null });
    const erroring = tab({ id: "t2", userName: "Zed", playing: { kind: "movie", title: "Heat", state: "error", error: "502", since: NOW } });
    const out = buildOnNow({ sessions: [browsing, tab(), erroring], jellyfin: null, streams: [], connections: null, now: NOW });
    expect(out.map((e) => e.userName)).toEqual(["Zed", "Jaker", "Al"]);
    expect(out[2].health).toMatchObject({ level: "unknown", label: "browsing" });
  });

  it("leaves an offline tab out", () => {
    const out = buildOnNow({ sessions: [tab({ presence: "offline" })], jellyfin: null, streams: [], connections: null, now: NOW });
    expect(out).toHaveLength(0);
  });
});

describe("streamHealth", () => {
  const base = { tab: null, playing: { kind: "live" as const, title: "X", state: "playing" as const, since: null }, jellyfin: roku, feedKnown: true, now: NOW };

  it("warns while the feed is still connecting, and when it runs slower than live", () => {
    expect(streamHealth({ ...base, feed: { ...feed, state: "connecting", clients: 0 } })).toMatchObject({ level: "warn" });
    const slow = streamHealth({ ...base, feed: { ...feed, speed: 0.8 } });
    expect(slow.level).toBe("warn");
    expect(slow.notes[0]).toMatch(/0\.80x/);
  });

  it("fails when the feed is up but Jellyfin isn't reading it, or the feed is in an error state", () => {
    expect(streamHealth({ ...base, feed: { ...feed, clients: 0 } })).toMatchObject({ level: "bad", notes: ["Jellyfin isn't reading the provider feed"] });
    expect(streamHealth({ ...base, feed: { ...feed, state: "error" } }).notes[0]).toBe("provider feed error");
  });

  it("treats a paused stream as fine even without a feed", () => {
    expect(streamHealth({ ...base, jellyfin: { ...roku, paused: true }, feed: null })).toMatchObject({ level: "ok", label: "paused" });
  });

  it("warns about a player that stopped checking in, and a transcoder that can't keep up", () => {
    const stale = streamHealth({ ...base, feed, jellyfin: { ...roku, checkInAgeS: 400 } });
    expect(stale).toMatchObject({ level: "warn" });
    expect(stale.notes[0]).toMatch(/checked in 400s ago/);
    expect(streamHealth({ ...base, feed, jellyfin: { ...roku, fps: 12 } }).notes[0]).toBe("transcoder at 12 fps");
  });

  it("reads the tab's own state and recent history", () => {
    const t = tab({ playing: { kind: "live", title: "X", state: "buffering", since: NOW - 60_000 } });
    expect(streamHealth({ ...base, tab: t, playing: { kind: "live", title: "X", state: "buffering", since: NOW - 60_000 }, feed })).toMatchObject({ level: "warn", notes: ["buffering"] });
    const rough = tab({ health: { verdict: "rough", starts: 1, medianStartMs: 3000, stalls: 4, stallMs: 12_000, errors: 0, retries: 0, lastError: null } });
    expect(streamHealth({ ...base, tab: rough, feed }).notes[0]).toBe("stalling: 4 stalls (12s) in 30 min");
    const tuning = tab({ playing: { kind: "live", title: "X", state: "tuning", since: NOW - 45_000 } });
    expect(streamHealth({ ...base, tab: tuning, playing: tuning.playing!, jellyfin: null, feed: null }).notes[0]).toBe("still tuning after 45s");
  });
});
