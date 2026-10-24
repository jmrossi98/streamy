import { describe, it, expect } from "vitest";
import { ALERT_DEDUPE_MS, alertMessage, incidentsToAlert, streamIncidents, type StreamIncident } from "../liveStreamAlertRules";
import type { LiveEvent } from "../liveChannelStateRules";

const T0 = Date.parse("2026-10-18T20:25:00Z");
const S = 1000;

function ev(at: number, kind: string, channel: string, detail: string | null = null, ms: number | null = null, sessionId = "s1"): LiveEvent {
  return { sessionId, userName: "jaker", at, kind, media: `Live: ${channel}`, detail, ms };
}

/** BEIN SPORTS 2 HD on 2026-10-18: four tries, the player gave up at 80 s. */
const bein = [
  ev(T0, "start", "BEIN SPORTS 2 HD"),
  ev(T0, "error", "BEIN SPORTS 2 HD", "Playback failed."),
  ev(T0 + 14 * S, "retry", "BEIN SPORTS 2 HD", "Playback failed."),
  ev(T0 + 18 * S, "stop", "BEIN SPORTS 2 HD", "stopped before the picture started", 18_000),
  ev(T0 + 18 * S, "start", "BEIN SPORTS 2 HD"),
  ev(T0 + 32 * S, "retry", "BEIN SPORTS 2 HD", "Playback failed."),
  ev(T0 + 39 * S, "stop", "BEIN SPORTS 2 HD", "stopped before the picture started", 21_000),
  ev(T0 + 39 * S, "start", "BEIN SPORTS 2 HD"),
  ev(T0 + 80 * S, "stop", "BEIN SPORTS 2 HD", "stopped before the picture started", 41_000),
];
const gaveUpAt = T0 + 80 * S;

describe("streamIncidents", () => {
  it("reports a tune that never reached a picture, once the player has given up for a minute", () => {
    expect(streamIncidents(bein, gaveUpAt + 30 * S)).toEqual([]);
    const [i] = streamIncidents(bein, gaveUpAt + 61 * S);
    expect(i).toMatchObject({ kind: "failed-start", channel: "BEIN SPORTS 2 HD", key: "beinsports2hd", tries: 3, userName: "jaker" });
  });

  it("does not report a failed start that a retry rescued within a minute", () => {
    // 2026-10-23: NFL Network hit a Dispatcharr 503 and played 3 s later.
    const events = [
      ev(T0, "start", "NFL NETWORK"),
      ev(T0 + 9 * S, "retry", "NFL NETWORK", "Playback failed."),
      ev(T0 + 12 * S, "stop", "NFL NETWORK", "stopped before the picture started", 12_000),
      ev(T0 + 12 * S, "start", "NFL NETWORK"),
      ev(T0 + 15 * S, "playing", "NFL NETWORK", null, 3000),
    ];
    expect(streamIncidents(events, T0 + 5 * 60 * S)).toEqual([]);
  });

  it("waits while a retry is still in flight", () => {
    const events = [...bein, ev(gaveUpAt + 1 * S, "start", "BEIN SPORTS 2 HD")];
    expect(streamIncidents(events, gaveUpAt + 70 * S)).toEqual([]);
  });

  it("forgets incidents older than the lookback", () => {
    expect(streamIncidents(bein, gaveUpAt + 60 * 60 * S)).toEqual([]);
  });

  it("reports more than three noticeable stalls within five minutes", () => {
    const stalls = [1200, 2400, 1500, 1100].map((ms, n) => ev(T0 + n * 40 * S, "stall", "ABC 7", null, ms));
    const [i] = streamIncidents(stalls, T0 + 3 * 60 * S);
    expect(i).toMatchObject({ kind: "stalling", stalls: 4, stalledMs: 6200 });
  });

  it("reports more than twenty seconds stalled within five minutes", () => {
    const stalls = [ev(T0, "stall", "ABC 7", null, 12_000), ev(T0 + 60 * S, "stall", "ABC 7", null, 9_000)];
    expect(streamIncidents(stalls, T0 + 2 * 60 * S)[0]).toMatchObject({ kind: "stalling", stalledMs: 21_000 });
  });

  it("ignores sub-second waits and stalls spread out over a long watch", () => {
    const blips = [3, 90, 500, 700, 400].map((ms, n) => ev(T0 + n * S, "stall", "ABC 7", null, ms));
    const spread = [2000, 2000, 2000, 2000].map((ms, n) => ev(T0 + n * 3 * 60 * S, "stall", "FOX", null, ms));
    expect(streamIncidents([...blips, ...spread], T0 + 10 * 60 * S)).toEqual([]);
  });
});

describe("incidentsToAlert", () => {
  const inc = (key: string, kind: StreamIncident["kind"], at = T0): StreamIncident => ({
    key,
    channel: key.toUpperCase(),
    userName: "jaker",
    sessionId: "s1",
    kind,
    at,
  });

  it("sends one per channel, preferring a failed start over stalling", () => {
    const out = incidentsToAlert([inc("a", "stalling"), inc("a", "failed-start"), inc("b", "stalling")], new Map(), T0);
    expect(out.map((i) => `${i.key}:${i.kind}`)).toEqual(["a:failed-start", "b:stalling"]);
  });

  it("skips a channel alerted within thirty minutes", () => {
    const last = new Map([["a", T0 - ALERT_DEDUPE_MS + 60_000]]);
    expect(incidentsToAlert([inc("a", "failed-start")], last, T0)).toEqual([]);
    const old = new Map([["a", T0 - ALERT_DEDUPE_MS - 1]]);
    expect(incidentsToAlert([inc("a", "failed-start")], old, T0)).toHaveLength(1);
  });
});

describe("alertMessage", () => {
  it("says who, which channel and what happened, with the Viewers link", () => {
    const [i] = streamIncidents(bein, gaveUpAt + 61 * S);
    const { subject, body } = alertMessage([i], { baseUrl: "https://streamy-app.com/", timeZone: "America/New_York" });
    expect(subject).toBe("Live TV: BEIN SPORTS 2 HD didn't start for jaker");
    expect(body).toContain("BEIN SPORTS 2 HD: never reached a picture for jaker after 3 tries (4:26 PM). Last error: Playback failed.");
    expect(body).toContain("https://streamy-app.com/admin/streaming (Viewers panel)");
  });

  it("says when other streams may have held every line", () => {
    const others = [
      ev(T0 - 600 * S, "start", "CBS 13", null, null, "s2"),
      ev(T0 - 590 * S, "playing", "CBS 13", null, 10_000, "s2"),
      ev(T0 - 300 * S, "start", "FOX 31", null, null, "s3"),
      ev(T0 - 290 * S, "playing", "FOX 31", null, 10_000, "s3"),
    ];
    const [i] = streamIncidents([...others, ...bein], gaveUpAt + 61 * S);
    expect(i.othersPlaying).toBe(2);
    const { body } = alertMessage([i], { baseUrl: null, timeZone: "America/New_York" });
    expect(body).toContain("2 other live streams were on, so the provider lines may all have been in use.");
  });

  it("puts several channels in one email", () => {
    const stall: StreamIncident = { key: "abc7", channel: "ABC 7", userName: "mom", sessionId: "s2", kind: "stalling", at: T0, stalls: 4, stalledMs: 21_400 };
    const [i] = streamIncidents(bein, gaveUpAt + 61 * S);
    const { subject, body } = alertMessage([stall, i], { baseUrl: null, timeZone: "America/New_York" });
    expect(subject).toBe("Live TV: 2 streams had problems");
    expect(body).toContain("ABC 7: kept buffering for mom - 4 stalls, 21s stalled within 5 minutes (4:25 PM).");
  });
});
