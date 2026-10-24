/**
 * The admin "On now" cards: every stream right now, whoever and wherever the
 * viewer is, each with one verdict on its health. Pure.
 *
 * Until 2026-10-24 the cards came from Streamy tabs' heartbeats alone, so a
 * Roku in the living room playing Live TV through the Jellyfin app -- and the
 * provider feed dying under it -- showed nothing on the admin page (the
 * Streams card listed the session, with no health). Four sources meet here:
 *
 *   - a Streamy tab's heartbeat and events: what the viewer sees;
 *   - Jellyfin's session: the Roku and the apps too, and how anyone is being
 *     served (direct or transcode, paused, when the player last checked in);
 *   - Dispatcharr's provider connection for a live channel: whether the feed
 *     is up and keeping pace with real time;
 *   - Streamy's own byte meter, for the streams it proxies: the real bitrate.
 *
 * Jellyfin and Dispatcharr know a channel by the same name (Jellyfin tunes to
 * the M3U Dispatcharr publishes), and a Streamy tab reports that name as its
 * title, so live streams join on channelKey(name). People join on user name:
 * Streamy accounts are mirrored into Jellyfin under the same names.
 */

import type { LiveConnection } from "./dispatcharr";
import { channelKey, LIVE_MEDIA_PREFIX } from "./liveChannelStateRules";
import type { DescribedSession } from "./streamingHeadroomRules";
import type { MeteredStream } from "./streamMeter";
import type { ViewerSessionView } from "./viewerActivity";
import type { PlaybackKind, PlayingNow } from "./viewerActivityRules";

export type HealthLevel = "ok" | "warn" | "bad" | "unknown";

export type StreamHealth = {
  level: HealthLevel;
  /** smooth | struggling | failing | paused | browsing */
  label: string;
  /** Why, worst first. Empty when there is nothing to say. */
  notes: string[];
};

export type OnNowPlaying = {
  kind: PlaybackKind | "video";
  title: string;
  /** The tab's state, or playing/paused from Jellyfin; null when nobody says. */
  state: PlayingNow["state"] | null;
  since: number | null;
};

export type OnNowEntry = {
  key: string;
  userName: string;
  /** Seen through a Streamy tab, or only as a Jellyfin app or device. */
  via: "streamy" | "jellyfin";
  device: string;
  /** A tab's city; a Jellyfin device's "at home" / "away" / "via Streamy". */
  place: string | null;
  ip: string | null;
  tab: ViewerSessionView | null;
  playing: OnNowPlaying | null;
  jellyfin: DescribedSession | null;
  /** Dispatcharr's connection for the channel, when the stream is live and it has one. */
  feed: LiveConnection | null;
  /** What Streamy itself is piping for this stream. */
  pipe: { mbps: number; bytes: number; since: number } | null;
  health: StreamHealth;
};

/** A live feed slower than this can't keep up with real time; the viewer buffers eventually. */
export const FEED_SLOW_SPEED = 0.95;
/** A tune still without a picture after this long is worth a note. */
export const LONG_TUNE_MS = 30_000;
/** A player that hasn't reported progress to Jellyfin in this long may be gone (Streamy pings every <60 s). */
export const STALE_CHECKIN_S = 120;
/** A transcoder below this output rate is not keeping up with any broadcast frame rate. */
export const LOW_TRANSCODE_FPS = 20;

const FEED_OK = new Set(["active"]);
const FEED_SETTLING = new Set(["connecting", "buffering", "waiting_for_clients", "initializing"]);

type HealthInputs = {
  tab: ViewerSessionView | null;
  playing: OnNowPlaying | null;
  jellyfin: DescribedSession | null;
  feed: LiveConnection | null;
  /** Whether Dispatcharr could be asked at all; without that, a missing feed means nothing. */
  feedKnown: boolean;
  now: number;
};

/** One verdict on a stream from everything that is known about it. */
export function streamHealth({ tab, playing, jellyfin, feed, feedKnown, now }: HealthInputs): StreamHealth {
  if (!playing) return { level: "unknown", label: "browsing", notes: [] };
  const paused = playing.state === "paused" || Boolean(jellyfin?.paused);
  const bad: string[] = [];
  const warn: string[] = [];

  const tabState = tab?.playing?.state ?? null;
  if (tabState === "error") bad.push(tab?.playing?.error ? `error: ${tab.playing.error}` : "the player reported an error");
  const h = tab?.health;
  if (h?.verdict === "failing") bad.push(h.lastError ? `errors in the last 30 min: ${h.lastError}` : "errors in the last 30 min");
  if (h?.verdict === "rough") warn.push(`stalling: ${h.stalls} stall${h.stalls === 1 ? "" : "s"} (${Math.round(h.stallMs / 1000)}s) in 30 min`);
  if (tabState === "buffering") warn.push("buffering");
  if (tabState === "tuning" && playing.since != null && now - playing.since > LONG_TUNE_MS) {
    warn.push(`still tuning after ${Math.round((now - playing.since) / 1000)}s`);
  }

  if (playing.kind === "live" && !paused) {
    if (feed) {
      if (!FEED_OK.has(feed.state) && !FEED_SETTLING.has(feed.state)) bad.push(`provider feed ${feed.state}`);
      else if (FEED_SETTLING.has(feed.state)) warn.push(`provider feed ${feed.state.replace(/_/g, " ")}`);
      else if (feed.clients === 0 && jellyfin) bad.push("Jellyfin isn't reading the provider feed");
      if (feed.speed != null && feed.speed < FEED_SLOW_SPEED) warn.push(`provider feed at ${feed.speed.toFixed(2)}x, slower than live`);
    } else if (feedKnown && (jellyfin || tabState === "playing" || tabState === "buffering")) {
      // Jellyfin is serving a channel Dispatcharr has no connection for: the
      // feed dropped (2026-10-24, 19:39: failover found nothing) or never opened.
      bad.push("no provider feed open for this channel");
    }
  }

  if (jellyfin && !paused) {
    if (jellyfin.checkInAgeS != null && jellyfin.checkInAgeS > STALE_CHECKIN_S) {
      warn.push(`player last checked in ${Math.round(jellyfin.checkInAgeS)}s ago`);
    }
    if (jellyfin.method === "transcode" && jellyfin.fps != null && jellyfin.fps < LOW_TRANSCODE_FPS) {
      warn.push(`transcoder at ${jellyfin.fps} fps`);
    }
  }

  if (bad.length > 0) return { level: "bad", label: "failing", notes: [...bad, ...warn] };
  if (warn.length > 0) return { level: "warn", label: "struggling", notes: warn };
  if (paused) return { level: "ok", label: "paused", notes: [] };
  return { level: "ok", label: "smooth", notes: [] };
}

export type OnNowInputs = {
  /** Every tab seen today; only those not offline are shown. */
  sessions: ViewerSessionView[];
  jellyfin: DescribedSession[] | null;
  streams: (MeteredStream & { title?: string | null })[];
  connections: LiveConnection[] | null;
  now: number;
};

const LEVEL_ORDER: Record<HealthLevel, number> = { bad: 0, warn: 1, ok: 2, unknown: 3 };
const PLACE: Record<DescribedSession["where"], string | null> = { lan: "at home", remote: "away", tailnet: "via Streamy", unknown: null };

/** The cards, worst health first, then whoever is playing, then whoever is just browsing. */
export function buildOnNow({ sessions, jellyfin, streams, connections, now }: OnNowInputs): OnNowEntry[] {
  const feedKnown = connections !== null;
  const feeds = connections ?? [];
  const unusedJf = new Set(jellyfin ?? []);
  const unusedStreams = new Set(streams);
  const entries: OnNowEntry[] = [];

  const takeFeed = (name: string | null) => (name ? feeds.find((f) => channelKey(f.channelName) === channelKey(name)) ?? null : null);
  const takePipe = (user: string, kind: string) => {
    const cands = [...unusedStreams].filter((s) => sameUser(s.user, user) && s.kind === kind);
    if (cands.length !== 1) return null;
    unusedStreams.delete(cands[0]);
    const s = cands[0];
    return { mbps: s.mbps, bytes: s.bytes, since: s.since };
  };

  for (const tab of sessions) {
    if (tab.presence === "offline") continue;
    const p = tab.playing;
    let jf: DescribedSession | null = null;
    if (p) {
      // Jellyfin's view of this same tab: same person, reached Jellyfin through
      // Streamy, playing the same title -- or their only such session.
      const cands = [...unusedJf].filter((s) => sameUser(s.user, tab.userName) && s.where === "tailnet");
      jf = cands.find((s) => sameTitle(s, p)) ?? (cands.length === 1 ? cands[0] : null);
      if (jf) unusedJf.delete(jf);
    }
    const playing: OnNowPlaying | null = p ? { kind: p.kind, title: p.title, state: p.state, since: p.since } : null;
    const feed = p?.kind === "live" ? takeFeed(p.title) : null;
    const pipe = p ? takePipe(tab.userName, p.kind) : null;
    entries.push({
      key: `tab:${tab.id}`,
      userName: tab.userName,
      via: "streamy",
      device: tab.device,
      place: tab.location,
      ip: tab.ip,
      tab,
      playing,
      jellyfin: jf,
      feed,
      pipe,
      health: streamHealth({ tab, playing, jellyfin: jf, feed, feedKnown, now }),
    });
  }

  // Everyone Jellyfin is serving that no tab accounts for: the Roku, the apps,
  // media.streamy-app.com -- or a Streamy viewer whose heartbeat went quiet.
  for (const s of unusedJf) {
    const kind: OnNowPlaying["kind"] = s.channel ? "live" : "video";
    const playing: OnNowPlaying = { kind, title: s.title, state: s.paused ? "paused" : "playing", since: null };
    const feed = s.channel ? takeFeed(s.channel) : null;
    const pipe = s.where === "tailnet" ? takePipe(s.user, kind) : null;
    entries.push({
      key: `jf:${s.id}`,
      userName: s.user,
      via: "jellyfin",
      device: [s.client, s.device].filter(Boolean).join(" · ") || "Jellyfin",
      place: PLACE[s.where],
      ip: s.ip,
      tab: null,
      playing,
      jellyfin: s,
      feed,
      pipe,
      health: streamHealth({ tab: null, playing, jellyfin: s, feed, feedKnown, now }),
    });
  }

  return entries.sort((a, b) => {
    const d = LEVEL_ORDER[a.health.level] - LEVEL_ORDER[b.health.level];
    if (d !== 0) return d;
    if (!!a.playing !== !!b.playing) return a.playing ? -1 : 1;
    return a.userName.localeCompare(b.userName);
  });
}

/** One line per failing stream, for the banner at the top of the panel. */
export function onNowAlerts(entries: OnNowEntry[]): string[] {
  return entries
    .filter((e) => e.health.level === "bad" && e.playing)
    .map((e) => `${e.userName}: ${e.playing!.title}${e.health.notes[0] ? ` — ${e.health.notes[0]}` : ""}`);
}

function sameUser(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Whether a Jellyfin session and a tab name the same thing, loosely: a channel name, or one title inside the other. */
function sameTitle(s: DescribedSession, p: PlayingNow): boolean {
  const a = channelKey(s.title.startsWith(LIVE_MEDIA_PREFIX) ? s.title.slice(LIVE_MEDIA_PREFIX.length) : s.title);
  const b = channelKey(p.title);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
