/**
 * Which live channels are not working for the people tuning them, from the
 * players' own telemetry (see liveChannelStateRules.ts for the rules).
 *
 * Derived on read from PlaybackEvent rather than kept as a stored flag: the
 * table already holds every tune for 14 days and is small (612 rows over the
 * fortnight to 2026-10-24, 446 of them live), so reading the live rows is
 * one indexed query, and a derived state cannot drift from the evidence --
 * a picture clears a channel the moment its event lands, with no second
 * write to forget. The only stored piece is LiveChannelState, for what the
 * events cannot say: an admin putting a channel back.
 *
 * Never probes a stream. Everything here is what viewers already did.
 */
import { prisma } from "./db";
import { cached, invalidateCache } from "./ttlCache";
import {
  LIVE_MEDIA_PREFIX,
  channelKey,
  channelWorkingStates,
  liveTunes,
  snapshotReading,
  type ChannelWorking,
  type LiveEvent,
  type SnapshotReading,
} from "./liveChannelStateRules";
import type { StreamHealth } from "./liveChannelRules";

/** PlaybackEvent's own retention (viewerActivity.ts KEEP_DAYS). */
const EVIDENCE_MS = 14 * 24 * 60 * 60_000;
/**
 * Short: a tune that just played should clear its channel for the next page
 * load, and the read is cheap. Long enough that a page and its game links
 * rendering together share one query.
 */
const CACHE_MS = 10_000;
const CACHE_KEY = "live-channel-state:evidence";

export async function readLiveEvents(sinceMs: number): Promise<LiveEvent[]> {
  const rows = await prisma.playbackEvent.findMany({
    where: { at: { gte: new Date(sinceMs) }, media: { startsWith: LIVE_MEDIA_PREFIX } },
    select: { sessionId: true, userName: true, at: true, kind: true, media: true, detail: true, ms: true },
    orderBy: { at: "asc" },
    take: 20_000,
  });
  return rows.map((r) => ({ ...r, at: r.at.getTime() }));
}

async function readEvidence(): Promise<{ events: LiveEvent[]; clearedAt: Map<string, number> }> {
  const [events, states] = await Promise.all([
    readLiveEvents(Date.now() - EVIDENCE_MS),
    prisma.liveChannelState.findMany({ where: { clearedAt: { not: null } }, select: { key: true, clearedAt: true } }),
  ]);
  return { events, clearedAt: new Map(states.map((s) => [s.key, s.clearedAt!.getTime()])) };
}

/**
 * Every channel with failed tunes on record and its state. A channel not in
 * the map is working. `snapshot` is mediabox's published health, when the
 * caller already has it, so a channel the checker has since opened comes back.
 * Never throws: on a database error nothing is hidden, which is how the
 * lineup behaved before this existed.
 */
export async function channelWorkingMap(
  snapshot: Map<string, StreamHealth> | null | undefined,
  now: number = Date.now()
): Promise<Map<string, ChannelWorking>> {
  try {
    const { events, clearedAt } = await cached(CACHE_KEY, CACHE_MS, readEvidence);
    const readings = new Map<string, SnapshotReading>();
    for (const [key, h] of snapshot ?? []) readings.set(key, snapshotReading(h));
    return channelWorkingStates({ tunes: liveTunes(events, now), snapshot: readings, clearedAt, now });
  } catch (err) {
    console.error("[live-channel-state] read failed:", err);
    return new Map();
  }
}

/** Puts a hidden channel back: tunes before now stop counting against it. */
export async function clearNotWorking(name: string, by: string): Promise<void> {
  const key = channelKey(name);
  const now = new Date();
  await prisma.liveChannelState.upsert({
    where: { key },
    create: { key, name, clearedAt: now, clearedBy: by },
    update: { name, clearedAt: now, clearedBy: by },
  });
  invalidateCache(CACHE_KEY);
}
