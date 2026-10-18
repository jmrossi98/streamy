/**
 * Everything the admin Streaming tab's live panel shows, gathered in one go.
 *
 * The one number that matters is the headroom: how much of the home upload
 * line is in use, from three sources that each know a different part --
 * this process's own byte meter (Streamy viewers), Jellyfin's sessions
 * (people on the Roku or the Jellyfin apps, counted only when they reached
 * it from outside the house), and qBittorrent's upload rate.
 */

import { getBoxVitals, vitalsAgeSeconds, type BoxVitals } from "./boxVitals";
import { prisma } from "./db";
import { getJellyfinPlayingSessions } from "./jellyfinSessions";
import { readNodeHealth, type NodeHealth } from "./nodeHealth";
import { getTorrentTransferRates } from "./qbittorrent";
import { streamMeter, type MeteredStream } from "./streamMeter";
import {
  headroom,
  remoteJellyfinMbps,
  uploadBudgetMbps,
  type DescribedSession,
  type Headroom,
} from "./streamingHeadroomRules";
import type { PlayingNow } from "./viewerActivityRules";

export type StreamingNow = {
  generatedAt: number;
  headroom: Headroom;
  /** Streamy's own streams, with what the viewer's tab says it is playing when that is known. */
  streams: (MeteredStream & { title: string | null })[];
  jellyfinSessions: DescribedSession[] | null;
  torrent: { upMbps: number; dlMbps: number } | null;
  node: NodeHealth;
  box: BoxVitals | null;
  boxAgeSeconds: number | null;
};

export async function getStreamingNow(now = Date.now()): Promise<StreamingNow> {
  const [box, torrent, jellyfinSessions, titles] = await Promise.all([
    getBoxVitals(),
    getTorrentTransferRates().catch(() => null),
    getJellyfinPlayingSessions(),
    playingTitles(now).catch(() => new Map<string, string | null>()),
  ]);
  const meter = streamMeter.snapshot();
  const torrentUpMbps = torrent ? Math.round((torrent.upBps * 8) / 1e5) / 10 : 0;
  const parts = [
    { label: "Streamy viewers", mbps: meter.totalMbps, kind: "streams" as const },
    { label: "Jellyfin apps, away from home", mbps: remoteJellyfinMbps(jellyfinSessions ?? []), kind: "jellyfin" as const },
    { label: "Torrent seeding", mbps: torrentUpMbps, kind: "torrent" as const },
  ];
  return {
    generatedAt: now,
    headroom: headroom(parts, uploadBudgetMbps(process.env.UPLOAD_BUDGET_MBPS)),
    streams: meter.streams.map((s) => ({ ...s, title: titles.get(`${s.user}\u0000${s.kind}`) ?? null })),
    jellyfinSessions,
    torrent: torrent ? { upMbps: torrentUpMbps, dlMbps: Math.round((torrent.dlBps * 8) / 1e5) / 10 } : null,
    node: readNodeHealth(),
    box,
    boxAgeSeconds: vitalsAgeSeconds(box, now),
  };
}

/**
 * user + kind -> the title that user's tab reports, when exactly one tab of
 * theirs is playing that kind. The meter knows item ids; the heartbeat knows
 * names; this is the join. Null marks an ambiguous match (two tabs, two
 * episodes) rather than guessing one.
 */
async function playingTitles(now: number): Promise<Map<string, string | null>> {
  const rows = await prisma.viewerSession.findMany({
    where: { lastSeenAt: { gte: new Date(now - 90_000) }, playing: { not: null } },
    select: { userName: true, playing: true },
  });
  const out = new Map<string, string | null>();
  for (const r of rows) {
    let p: PlayingNow | null = null;
    try {
      p = r.playing ? (JSON.parse(r.playing) as PlayingNow) : null;
    } catch {
      p = null;
    }
    if (!p) continue;
    const k = `${r.userName}\u0000${p.kind}`;
    out.set(k, out.has(k) ? null : p.title);
  }
  return out;
}
