/**
 * The rules behind the admin "Viewers" panel. Pure.
 *
 * Signed-in tabs report a heartbeat (where they are, what they are playing)
 * and playback events (start, first picture, buffering, errors). This module
 * cleans what arrives and turns a session's events into the one question the
 * panel answers: is this person's playback running smoothly?
 */

export const PLAYBACK_EVENT_KINDS = ["start", "playing", "stall", "error", "retry", "stop"] as const;
export type PlaybackEventKind = (typeof PLAYBACK_EVENT_KINDS)[number];

export type PlaybackKind = "live" | "movie" | "episode" | "recording";

/** What a tab is playing right now, as its heartbeat reports it. */
export type PlayingNow = {
  kind: PlaybackKind;
  /** "CW 36 (KICU) SAN JOSE HD", "Frieren S1E29". */
  title: string;
  /** tuning | playing | buffering | error | paused */
  state: "tuning" | "playing" | "buffering" | "error" | "paused";
  /** The error shown to the viewer, when state is error. */
  error?: string | null;
  /** When this item started, epoch ms, so the panel can say "for 12 min". */
  since: number;
};

export type IncomingEvent = { kind: PlaybackEventKind; media: string; detail?: string | null; ms?: number | null; at?: number };

export type PresencePayload = {
  sessionId: string;
  path: string | null;
  playing: PlayingNow | null;
  events: IncomingEvent[];
};

const MAX_EVENTS = 50;
const clip = (v: unknown, n: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;

/**
 * A heartbeat body made safe to store, or null when it isn't one.
 *
 * Every field is clipped and every enum checked: the body comes from a
 * browser, and this table is read back into the admin page.
 */
export function parsePresence(body: unknown, now = Date.now()): PresencePayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const sessionId = clip(b.sessionId, 64);
  if (!sessionId || !/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) return null;

  let playing: PlayingNow | null = null;
  const p = b.playing as Record<string, unknown> | null | undefined;
  if (p && typeof p === "object") {
    const kind = p.kind as PlaybackKind;
    const state = p.state as PlayingNow["state"];
    const title = clip(p.title, 200);
    if (
      title &&
      ["live", "movie", "episode", "recording"].includes(kind) &&
      ["tuning", "playing", "buffering", "error", "paused"].includes(state)
    ) {
      const since = typeof p.since === "number" && p.since > 0 && p.since <= now ? p.since : now;
      playing = { kind, title, state, error: clip(p.error, 300), since };
    }
  }

  const events: IncomingEvent[] = [];
  for (const e of Array.isArray(b.events) ? b.events.slice(0, MAX_EVENTS) : []) {
    if (!e || typeof e !== "object") continue;
    const ev = e as Record<string, unknown>;
    const media = clip(ev.media, 200);
    if (!media || !PLAYBACK_EVENT_KINDS.includes(ev.kind as PlaybackEventKind)) continue;
    const ms = typeof ev.ms === "number" && Number.isFinite(ev.ms) && ev.ms >= 0 ? Math.min(Math.round(ev.ms), 86_400_000) : null;
    // The browser's own clock, but never in the future and never more than
    // an hour back: a tab that slept can flush late, not rewrite history.
    const at = typeof ev.at === "number" && ev.at <= now && ev.at > now - 3_600_000 ? ev.at : now;
    events.push({ kind: ev.kind as PlaybackEventKind, media, detail: clip(ev.detail, 300), ms, at });
  }

  return { sessionId, path: clip(b.path, 300), playing, events };
}

/** "iPhone · Safari", "Windows · Chrome", from a user agent. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Roku/i.test(ua)
          ? "Roku"
          : /Windows/.test(ua)
            ? "Windows"
            : /Macintosh|Mac OS X/.test(ua)
              ? "Mac"
              : /CrOS/.test(ua)
                ? "ChromeOS"
                : /Linux/.test(ua)
                  ? "Linux"
                  : "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  return browser ? `${device} · ${browser}` : device;
}

/** Seen in the last minute: on the site now. In the last five: idle (a backgrounded tab). */
export function presenceOf(lastSeenAt: number, now = Date.now()): "online" | "idle" | "offline" {
  const age = now - lastSeenAt;
  if (age <= 60_000) return "online";
  if (age <= 5 * 60_000) return "idle";
  return "offline";
}

/**
 * Longest a session's last heartbeat can be stale and still count as playing.
 * A foreground tab beats every 20s; this covers one missed beat. Past it, a
 * tab that closed without its "stopped" beat landing stops being shown as
 * playing rather than lingering for the full idle window.
 */
export const PLAYING_FRESH_MS = 45_000;

/** Whether a session's "playing" is current, not a value left behind by a closed tab. */
export function isActivelyPlaying(lastSeenAt: number, now = Date.now()): boolean {
  return now - lastSeenAt <= PLAYING_FRESH_MS;
}

/** The shortest stall that counts against a session. */
export const NOTICEABLE_STALL_MS = 1_000;

/** How far back a session's verdict looks: now, not an hour ago. */
export const VERDICT_WINDOW_MS = 30 * 60_000;

export type SessionHealth = {
  /** smooth | rough (buffering) | failing (errors) | none (nothing played) */
  verdict: "smooth" | "rough" | "failing" | "none";
  starts: number;
  /** Median time to first picture, ms. */
  medianStartMs: number | null;
  stalls: number;
  stallMs: number;
  errors: number;
  retries: number;
  lastError: string | null;
};

/**
 * Whether a session's playback ran well, from its events.
 *
 * Failing: an error, or a start that never reached a picture. Rough: more
 * than two stalls, or more than ten seconds stalled. Otherwise smooth.
 */
export function sessionHealth(events: { kind: string; ms: number | null; detail: string | null; at: number }[]): SessionHealth {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  let starts = 0;
  let stalls = 0;
  let stallMs = 0;
  let errors = 0;
  let retries = 0;
  let lastError: string | null = null;
  const startTimes: number[] = [];
  let open = false; // a start not yet followed by a picture
  let neverPlayed = 0;
  for (const e of sorted) {
    if (e.kind === "start") {
      if (open) neverPlayed += 1;
      starts += 1;
      open = true;
    } else if (e.kind === "playing") {
      if (open && e.ms != null) startTimes.push(e.ms);
      open = false;
    } else if (e.kind === "stall") {
      // Under a second isn't something a viewer sees: a seek settling, a
      // segment boundary. Counting those called a smooth episode "buffering"
      // (2026-10-18: waits of 3ms and 90ms).
      if ((e.ms ?? 0) < NOTICEABLE_STALL_MS) continue;
      stalls += 1;
      stallMs += e.ms ?? 0;
    } else if (e.kind === "error") {
      errors += 1;
      lastError = e.detail ?? lastError;
    } else if (e.kind === "retry") {
      retries += 1;
    } else if (e.kind === "stop") {
      if (open) neverPlayed += 1;
      open = false;
    }
  }
  startTimes.sort((a, b) => a - b);
  const medianStartMs = startTimes.length ? startTimes[Math.floor((startTimes.length - 1) / 2)] : null;
  const verdict =
    starts === 0 && errors === 0
      ? "none"
      : errors > 0 || neverPlayed > 0
        ? "failing"
        : stalls > 2 || stallMs > 10_000
          ? "rough"
          : "smooth";
  return { verdict, starts, medianStartMs, stalls, stallMs, errors: errors + neverPlayed, retries, lastError };
}
