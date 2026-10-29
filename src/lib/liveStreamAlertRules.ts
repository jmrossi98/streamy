/**
 * When a live stream failing someone is worth emailing the admin about. Pure.
 *
 * 2026-10-23, Jake: "Yes please alert me when streams don't work." Until now
 * the only way to learn a channel had failed was to be the one watching, or
 * to open the Viewers panel and read it there afterwards.
 *
 * Two things count, both from the telemetry players already send:
 *
 *   - a tune that never reached a picture, after the player's own retries;
 *   - a stream that played but kept stalling.
 *
 * Neither fires for the ordinary noise: a start the player's retry rescued
 * within RECOVERED_START_MS (2026-10-23, NFL Network hit a Dispatcharr 503
 * and played 3 s later), or a sub-second wait.
 */

import { LIVE_MEDIA_PREFIX, channelKey, liveTunes, streamsPlayingDuring, type LiveEvent } from "./liveChannelStateRules";
import { NOTICEABLE_STALL_MS, RECOVERED_START_MS } from "./viewerActivityRules";

/** Rolling window that stalls are counted in. */
export const STALL_WINDOW_MS = 5 * 60_000;
/** More stalls than this in the window is "keeps buffering". */
export const MAX_STALLS = 3;
/** Or more time than this spent stalled in the window. */
export const MAX_STALLED_MS = 20_000;
/** At most one alert per channel in this long: one bad evening is one email, not twenty. */
export const ALERT_DEDUPE_MS = 30 * 60_000;
/**
 * How far back a check looks for something to report. Longer than the
 * wait below plus the gap between checks, shorter than the dedupe window,
 * so an incident can be reported at most once.
 */
export const ALERT_LOOKBACK_MS = 15 * 60_000;

export type StreamIncident = {
  key: string;
  channel: string;
  userName: string;
  sessionId: string;
  kind: "failed-start" | "stalling";
  at: number;
  /** failed-start: tries, the player's own retries included. */
  tries?: number;
  lastError?: string | null;
  /** failed-start: other live streams on at the time -- a full house of lines, not a dead channel. */
  othersPlaying?: number;
  /** stalling: noticeable stalls and time stalled within STALL_WINDOW_MS. */
  stalls?: number;
  stalledMs?: number;
};

/**
 * Incidents in a set of events, at most one per tab and channel.
 *
 * A failed tune is only final once RECOVERED_START_MS has passed with no
 * picture -- a retry that lands inside that is the player doing its job --
 * and while a try is still in flight there is nothing to say yet.
 */
export function streamIncidents(events: LiveEvent[], now: number = Date.now()): StreamIncident[] {
  const since = now - ALERT_LOOKBACK_MS;
  const out: StreamIncident[] = [];

  const tunes = liveTunes(events, now);
  for (const t of tunes) {
    if (t.outcome !== "failed") continue;
    if (t.endedAt < since || now - t.endedAt < RECOVERED_START_MS) continue;
    out.push({
      key: t.key,
      channel: t.channel,
      userName: t.userName,
      sessionId: t.sessionId,
      kind: "failed-start",
      at: t.endedAt,
      tries: t.tries,
      lastError: t.lastError,
      othersPlaying: streamsPlayingDuring(t, tunes),
    });
  }

  const stallsBy = new Map<string, LiveEvent[]>();
  for (const e of events) {
    if (!isNoticeableLiveStall(e)) continue;
    const id = `${e.sessionId}\u0000${e.media}`;
    const list = stallsBy.get(id);
    if (list) list.push(e);
    else stallsBy.set(id, [e]);
  }
  for (const list of stallsBy.values()) {
    // The first moment the window tips over; one incident per tab and channel.
    const first = stallingTips(list)[0];
    if (first && first.at >= since) {
      const channel = first.event.media.slice(LIVE_MEDIA_PREFIX.length).trim();
      out.push({
        key: channelKey(channel),
        channel,
        userName: first.event.userName,
        sessionId: first.event.sessionId,
        kind: "stalling",
        at: first.at,
        stalls: first.stalls,
        stalledMs: first.stalledMs,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A noticeable stall on a live channel: the only stalls "stalling" counts. */
export function isNoticeableLiveStall(e: LiveEvent): boolean {
  return e.kind === "stall" && e.media.startsWith(LIVE_MEDIA_PREFIX) && (e.ms ?? 0) >= NOTICEABLE_STALL_MS;
}

/**
 * Every stall in one tab's run of one channel at which the rolling window
 * reads "keeps buffering" (more than MAX_STALLS, or more than MAX_STALLED_MS
 * stalled, within STALL_WINDOW_MS), oldest first. `stalls` is that tab's
 * noticeable stalls of that channel, in any order. The single definition of
 * "stalling", shared by the alert email and the ranking (viewerSlowRules.ts).
 */
export function stallingTips(
  stalls: LiveEvent[]
): { at: number; event: LiveEvent; stalls: number; stalledMs: number }[] {
  const list = [...stalls].sort((a, b) => a.at - b.at);
  const tips: { at: number; event: LiveEvent; stalls: number; stalledMs: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    const end = list[i].at;
    const inWindow = list.filter((s) => s.at <= end && s.at > end - STALL_WINDOW_MS);
    const stalledMs = inWindow.reduce((n, s) => n + (s.ms ?? 0), 0);
    if (inWindow.length > MAX_STALLS || stalledMs > MAX_STALLED_MS) {
      tips.push({ at: end, event: list[i], stalls: inWindow.length, stalledMs });
    }
  }
  return tips;
}

/**
 * The incidents to email now: one per channel, none for a channel alerted
 * within ALERT_DEDUPE_MS. A failed start wins over stalling for the same
 * channel -- it is the worse of the two.
 */
export function incidentsToAlert(
  incidents: StreamIncident[],
  lastAlertedAt: Map<string, number>,
  now: number = Date.now()
): StreamIncident[] {
  const chosen = new Map<string, StreamIncident>();
  for (const i of incidents) {
    const last = lastAlertedAt.get(i.key);
    if (last != null && now - last < ALERT_DEDUPE_MS) continue;
    const have = chosen.get(i.key);
    if (!have || (have.kind === "stalling" && i.kind === "failed-start")) chosen.set(i.key, i);
  }
  return [...chosen.values()].sort((a, b) => a.at - b.at);
}

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

function describe(i: StreamIncident, timeZone: string): string {
  const when = clock(i.at, timeZone);
  if (i.kind === "failed-start") {
    const tries = i.tries && i.tries > 1 ? ` after ${i.tries} tries` : "";
    const why = i.lastError ? ` Last error: ${i.lastError}` : "";
    const busy = i.othersPlaying
      ? ` ${i.othersPlaying} other live stream${i.othersPlaying === 1 ? " was" : "s were"} on, so the provider lines may all have been in use.`
      : "";
    return `- ${i.channel}: never reached a picture for ${i.userName}${tries} (${when}).${why}${busy}`;
  }
  const secs = Math.round((i.stalledMs ?? 0) / 1000);
  return `- ${i.channel}: kept buffering for ${i.userName} - ${i.stalls} stalls, ${secs}s stalled within 5 minutes (${when}).`;
}

/**
 * Subject and body for one email covering every incident in a check. One
 * email rather than one per channel: when the whole pipeline is down, someone
 * flicking through channels produces a failure on each, and seven emails in a
 * minute say less than one listing seven channels.
 */
export function alertMessage(
  incidents: StreamIncident[],
  opts: { baseUrl: string | null; timeZone: string }
): { subject: string; body: string } {
  const first = incidents[0];
  const subject =
    incidents.length === 1
      ? first.kind === "failed-start"
        ? `Live TV: ${first.channel} didn't start for ${first.userName}`
        : `Live TV: ${first.channel} kept buffering for ${first.userName}`
      : `Live TV: ${incidents.length} streams had problems`;
  const link = opts.baseUrl ? `${opts.baseUrl.replace(/\/$/, "")}/admin/streaming` : "/admin/streaming";
  const body = [
    incidents.length === 1 ? "A live stream didn't work:" : "Live streams that didn't work:",
    "",
    ...incidents.map((i) => describe(i, opts.timeZone)),
    "",
    `Who's watching what, and each session's events: ${link} (Viewers panel)`,
    "",
    "At most one email per channel every 30 minutes.",
  ].join("\n");
  return { subject, body };
}
