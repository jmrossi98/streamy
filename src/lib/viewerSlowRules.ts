/**
 * Viewers stalling on a channel, as a slow reading for its ranking. Pure.
 *
 * 2026-10-27 (Sabres at Sharks): a viewer's game page defaulted to trex's
 * "NHL SAN JOSE SHARKS", whose feed ran at 0.93-0.95x real time and stalled
 * all game. The admin was emailed (liveStreamAlertRules.ts), but the ranking
 * only knew the channel checker's speed readings, so the next viewer would
 * have been sent to the same feed. Her own player was the best evidence there
 * was; this makes it count.
 *
 * A tab's run of a channel that met the alert's "stalling" definition
 * (stallingTips) is a slow reading for that channel. How much it counts:
 *
 *   - Corroborated -- two or more people stalled on it, or the same tab
 *     played another live channel smoothly around the same time (her
 *     Spectrum News on the same provider played fine: the feed, not her
 *     wifi) -- it holds for SPEED_TRUST_MS, like a measured slow speed.
 *   - One person, nothing to compare with -- it may be their connection, so
 *     it holds for WEAK_TRUST_MS only.
 *   - One person who stalled on other channels in the same stretch too -- that
 *     is their connection, and it does not count at all.
 *
 * Several viewers rank it a little lower than one. A later good reading
 * clears it: the checker measuring the feed at CLEAR_SPEED or better after
 * the last stall, or anyone playing it SMOOTH_PROOF_MS without a stall.
 */

import { KEEPING_UP_SPEED, SPEED_TRUST_MS } from "./liveChannelRules";
import { channelKey, LIVE_MEDIA_PREFIX, liveTunes, type LiveEvent, type Tune } from "./liveChannelStateRules";
import { isNoticeableLiveStall, STALL_WINDOW_MS, stallingTips } from "./liveStreamAlertRules";

/** How long one uncorroborated viewer's stalling counts. */
export const WEAK_TRUST_MS = 60 * 60_000;
/** How far either side of a stalling run another channel's playback is compared. */
export const CONTROL_WINDOW_MS = 30 * 60_000;
/** Playback of another channel at least this long, without stalling, is a smooth control. */
export const SMOOTH_CONTROL_MS = 5 * 60_000;
/** Playback of this channel at least this long after the last stall, without one, clears it. */
export const SMOOTH_PROOF_MS = 10 * 60_000;
/**
 * A checker reading clears viewer stalling only at this speed or better. The
 * ranking's own line (KEEPING_UP_SPEED, 0.95) is too close: the feed that
 * stalled all game on 2026-10-27 measured 0.93-0.95.
 */
export const CLEAR_SPEED = 1.0;

/** One tab's stalling run on one channel. */
export type StallRun = {
  key: string;
  channel: string;
  sessionId: string;
  userName: string;
  firstAt: number;
  lastAt: number;
  stalls: number;
};

export type ViewerSlow = {
  key: string;
  channel: string;
  /** Who stalled on it (counted runs only). */
  people: string[];
  /** Stalling runs counted against it. */
  runs: number;
  /** Two or more people, or a viewer who played another channel smoothly meanwhile. */
  corroborated: boolean;
  firstAt: number;
  lastStallAt: number;
  /** When this stops counting with no new evidence. */
  until: number;
  /** streamQualityRank-compatible: above 2, a little lower per extra person. */
  rank: number;
};

/** The checker's latest speed reading for a channel, as the clearing rule needs it. */
export type SpeedReading = { speed: number; at: number };

/** Every tab's stalling runs, oldest first. */
export function stallRuns(events: LiveEvent[]): StallRun[] {
  const by = new Map<string, LiveEvent[]>();
  for (const e of events) {
    if (!isNoticeableLiveStall(e)) continue;
    const id = `${e.sessionId}\u0000${e.media}`;
    const list = by.get(id);
    if (list) list.push(e);
    else by.set(id, [e]);
  }
  const runs: StallRun[] = [];
  for (const list of by.values()) {
    const tips = stallingTips(list);
    if (tips.length === 0) continue;
    const channel = list[0].media.slice(LIVE_MEDIA_PREFIX.length).trim();
    const first = tips[0];
    const last = tips[tips.length - 1];
    runs.push({
      key: channelKey(channel),
      channel,
      sessionId: first.event.sessionId,
      userName: first.event.userName,
      // The window that tipped began before its last stall.
      firstAt: Math.min(...list.filter((s) => s.at <= first.at && s.at > first.at - STALL_WINDOW_MS).map((s) => s.at)),
      lastAt: last.at,
      stalls: list.filter((s) => s.at <= last.at).length,
    });
  }
  return runs.sort((a, b) => a.firstAt - b.firstAt);
}

/** Noticeable stalls of one tab on one channel, by tab+channel key. */
function stallsBySessionChannel(events: LiveEvent[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const e of events) {
    if (!isNoticeableLiveStall(e)) continue;
    const id = `${e.sessionId}\u0000${channelKey(e.media.slice(LIVE_MEDIA_PREFIX.length))}`;
    const list = out.get(id);
    if (list) list.push(e.at);
    else out.set(id, [e.at]);
  }
  return out;
}

/**
 * The longest stretch of a played tune within [from, to] with no noticeable
 * stall from that tab, in ms.
 */
function longestSmoothSpan(tune: Tune, stalls: number[], from: number, to: number, lastSeen?: number): number {
  if (tune.outcome !== "played") return 0;
  const start = Math.max(from, tune.pictureAt ?? tune.startedAt);
  // A tune with no stop is assumed to play on (liveTunes), but a phone tab
  // closed mid-stall never sends one: never past the tab's last heartbeat.
  const end = Math.min(to, tune.playedUntil ?? tune.endedAt, lastSeen ?? Infinity);
  if (end <= start) return 0;
  const cuts = stalls.filter((t) => t > start && t < end).sort((a, b) => a - b);
  let best = 0;
  let prev = start;
  for (const c of [...cuts, end]) {
    best = Math.max(best, c - prev);
    prev = c;
  }
  return best;
}

/**
 * Channels viewers have been stalling on, still counting at `now`. A channel
 * not in the map has no viewer evidence against it.
 */
export function viewerSlowChannels(
  events: LiveEvent[],
  opts: {
    now?: number;
    checker?: Map<string, SpeedReading>;
    /** Each tab's last heartbeat. Without one, a tune with no stop counts as playing for as long as liveTunes assumes. */
    lastSeen?: Map<string, number>;
  } = {}
): Map<string, ViewerSlow> {
  const now = opts.now ?? Date.now();
  const runs = stallRuns(events).filter((r) => now - r.lastAt < SPEED_TRUST_MS);
  if (runs.length === 0) return new Map();
  const tunes = liveTunes(events, now);
  const stalls = stallsBySessionChannel(events);
  const stallsOf = (sessionId: string, key: string) => stalls.get(`${sessionId}\u0000${key}`) ?? [];
  const allRuns = stallRuns(events);

  // Per run: did the same tab play another channel smoothly, or stall on one, around it?
  const assessed = runs.map((r) => {
    const from = r.firstAt - CONTROL_WINDOW_MS;
    const to = r.lastAt + CONTROL_WINDOW_MS;
    const stalledElsewhere = allRuns.some(
      (o) => o.sessionId === r.sessionId && o.key !== r.key && o.lastAt >= from && o.firstAt <= to
    );
    const smoothElsewhere =
      !stalledElsewhere &&
      tunes.some(
        (t) =>
          t.sessionId === r.sessionId &&
          t.key !== r.key &&
          longestSmoothSpan(t, stallsOf(t.sessionId, t.key), from, to, opts.lastSeen?.get(t.sessionId)) >= SMOOTH_CONTROL_MS
      );
    return { run: r, stalledElsewhere, smoothElsewhere };
  });

  const byKey = new Map<string, typeof assessed>();
  for (const a of assessed) {
    const list = byKey.get(a.run.key);
    if (list) list.push(a);
    else byKey.set(a.run.key, [a]);
  }

  const out = new Map<string, ViewerSlow>();
  for (const [key, list] of byKey) {
    const everyone = new Set(list.map((a) => a.run.userName));
    // Two people stalling on one channel is the channel, whatever else their
    // connections did; one person stalling everywhere is their connection.
    const counted = everyone.size >= 2 ? list : list.filter((a) => !a.stalledElsewhere);
    if (counted.length === 0) continue;
    const people = [...new Set(counted.map((a) => a.run.userName))];
    const corroborated = people.length >= 2 || counted.some((a) => a.smoothElsewhere);
    const lastStallAt = Math.max(...counted.map((a) => a.run.lastAt));
    const until = lastStallAt + (corroborated ? SPEED_TRUST_MS : WEAK_TRUST_MS);
    if (now >= until) continue;

    // A good reading since the last stall clears it.
    const reading = opts.checker?.get(key);
    if (reading && reading.at > lastStallAt && reading.speed >= CLEAR_SPEED) continue;
    const smoothSince = tunes.some(
      (t) => t.key === key && longestSmoothSpan(t, stallsOf(t.sessionId, key), lastStallAt, now, opts.lastSeen?.get(t.sessionId)) >= SMOOTH_PROOF_MS
    );
    if (smoothSince) continue;

    out.set(key, {
      key,
      channel: counted[counted.length - 1].run.channel,
      people,
      runs: counted.length,
      corroborated,
      firstAt: Math.min(...counted.map((a) => a.run.firstAt)),
      lastStallAt,
      until,
      rank: viewerSlowRank(people.length, corroborated),
    });
  }
  return out;
}

/**
 * Where viewer stalling puts a channel on streamQualityRank's scale: in the
 * "slow" band (above 2), as if measured a little under KEEPING_UP_SPEED, and
 * a little lower for each extra person (up to four). A checker reading that
 * says worse still wins (the caller takes the worse of the two).
 */
export function viewerSlowRank(people: number, corroborated: boolean): number {
  const base = 2 + (KEEPING_UP_SPEED - 0.9);
  return base + 0.05 * (Math.min(people, 4) - 1) + (corroborated ? 0.02 : 0);
}

/** The ranking with viewer evidence folded in: the worse of the checker's rank and the viewers'. */
export function rankWithViewers(checkerRank: number | undefined, slow: ViewerSlow | undefined): number | undefined {
  if (!slow) return checkerRank;
  return Math.max(checkerRank ?? 1, slow.rank);
}
