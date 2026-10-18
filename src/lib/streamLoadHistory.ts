/**
 * A minute-by-minute record of how busy streaming was, for the admin
 * Streaming tab's history: peak concurrency per day, and the last day's load.
 *
 * Sampled from the presence heartbeat (api/presence) rather than a timer:
 * Streamy has no background scheduler, and heartbeats arrive every 20 s from
 * every open tab, which is exactly when there is anything to record. Nobody
 * on means no rows, which reads as zero. The impure half; the aggregation is
 * in streamLoadHistoryRules.ts.
 */

import { prisma } from "./db";
import { getTorrentTransferRates } from "./qbittorrent";
import { streamMeter } from "./streamMeter";
import { countPlaying, dailyPeaks, thinSamples, type DailyPeak, type LoadSample } from "./streamLoadHistoryRules";
import type { PlayingNow } from "./viewerActivityRules";
import { cached } from "./ttlCache";

const SAMPLE_EVERY_MS = 60_000;
const KEEP_DAYS = 90;
const DAY_MS = 24 * 60 * 60_000;
const CHART_POINTS = 288;

let lastSampleAt = 0;
let lastPruneAt = 0;

/** Records one sample, at most once a minute. Cheap to call on every heartbeat. */
export async function maybeSampleStreamLoad(now = Date.now()): Promise<void> {
  if (now - lastSampleAt < SAMPLE_EVERY_MS) return;
  lastSampleAt = now;
  const rows = await prisma.viewerSession.findMany({
    where: { lastSeenAt: { gte: new Date(now - 60_000) }, playing: { not: null } },
    select: { playing: true },
  });
  const playing = rows.map((r) => {
    try {
      return r.playing ? (JSON.parse(r.playing) as PlayingNow) : null;
    } catch {
      return null;
    }
  });
  const counts = countPlaying(playing);
  const meter = streamMeter.snapshot();
  const torrent = await getTorrentTransferRates().catch(() => null);
  await prisma.streamLoadSample.create({
    data: {
      at: new Date(now),
      playing: counts.playing,
      live: counts.live,
      vod: counts.vod,
      proxyMbps: meter.totalMbps,
      torrentUpMbps: torrent ? Math.round((torrent.upBps * 8) / 1e5) / 10 : null,
    },
  });
  if (now - lastPruneAt > DAY_MS) {
    lastPruneAt = now;
    await prisma.streamLoadSample.deleteMany({ where: { at: { lt: new Date(now - KEEP_DAYS * DAY_MS) } } }).catch(() => {});
  }
}

export type StreamLoadHistory = {
  generatedAt: number;
  /** The last 24 hours, thinned for a chart. */
  samples: LoadSample[];
  /** The last 30 days, one row per day with any sample. */
  peaks: DailyPeak[];
};

export async function getStreamLoadHistory(now = Date.now()): Promise<StreamLoadHistory> {
  return cached("stream-load:history", 60_000, async () => {
    const rows = await prisma.streamLoadSample.findMany({
      where: { at: { gte: new Date(now - 30 * DAY_MS) } },
      orderBy: { at: "asc" },
      select: { at: true, playing: true, live: true, vod: true, proxyMbps: true, torrentUpMbps: true },
    });
    const samples: LoadSample[] = rows.map((r) => ({ ...r, at: r.at.getTime() }));
    return {
      generatedAt: now,
      samples: thinSamples(samples.filter((s) => s.at >= now - DAY_MS), CHART_POINTS),
      peaks: dailyPeaks(samples),
    };
  });
}
