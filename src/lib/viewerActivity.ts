import { prisma } from "./db";
import { locateMany } from "./geoip";
import { isDispatcharrConfigured, listIptvAccounts, liveConnections, type LiveConnection } from "./dispatcharr";
import { maybeSampleStreamLoad } from "./streamLoadHistory";
import { cached } from "./ttlCache";
import {
  deviceLabel,
  presenceOf,
  sessionHealth,
  VERDICT_WINDOW_MS,
  type PlayingNow,
  type PresencePayload,
  type SessionHealth,
} from "./viewerActivityRules";

const KEEP_DAYS = 14;
const WINDOW_MS = 24 * 60 * 60_000;
let lastPrune = 0;

/** Stores one heartbeat: the tab's whereabouts, and any playback events it queued. */
export async function recordPresence(
  p: PresencePayload,
  who: { userId: string; userName: string; ip: string; userAgent: string | null }
): Promise<void> {
  const now = new Date();
  const playing = p.playing ? JSON.stringify(p.playing) : null;
  await prisma.viewerSession.upsert({
    where: { id: p.sessionId },
    create: {
      id: p.sessionId,
      userId: who.userId,
      userName: who.userName,
      ip: who.ip,
      userAgent: who.userAgent,
      path: p.path,
      playing,
      startedAt: now,
      lastSeenAt: now,
    },
    // userId is checked, not overwritten: a tab id is only ever its own user's.
    update: { ip: who.ip, userAgent: who.userAgent, path: p.path, playing, lastSeenAt: now, userName: who.userName },
  });
  if (p.events.length > 0) {
    await prisma.playbackEvent.createMany({
      data: p.events.map((e) => ({
        sessionId: p.sessionId,
        userId: who.userId,
        userName: who.userName,
        at: new Date(e.at ?? now.getTime()),
        kind: e.kind,
        media: e.media,
        detail: e.detail ?? null,
        ms: e.ms ?? null,
      })),
    });
  }
  // The minute-by-minute load record rides on the heartbeat (streamLoadHistory.ts).
  void maybeSampleStreamLoad(now.getTime()).catch((err) => console.error("[presence] load sample failed:", err));
  if (now.getTime() - lastPrune > 60 * 60_000) {
    lastPrune = now.getTime();
    const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60_000);
    await Promise.all([
      prisma.viewerSession.deleteMany({ where: { lastSeenAt: { lt: cutoff } } }),
      prisma.playbackEvent.deleteMany({ where: { at: { lt: cutoff } } }),
    ]).catch(() => {});
  }
}

/** The owner of a session id, so a tab can't write into someone else's row. */
export async function sessionOwner(sessionId: string): Promise<string | null> {
  const row = await prisma.viewerSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
  return row?.userId ?? null;
}

export type ViewerEvent = { at: number; kind: string; media: string; detail: string | null; ms: number | null };

export type ViewerSessionView = {
  id: string;
  userName: string;
  device: string;
  ip: string;
  location: string | null;
  path: string | null;
  presence: "online" | "idle" | "offline";
  startedAt: number;
  lastSeenAt: number;
  playing: PlayingNow | null;
  health: SessionHealth;
  events: ViewerEvent[];
};

export type ProviderLine = { id: number; provider: string; line: string; maxStreams: number; viewers: number; active: boolean };

export type ViewerActivity = {
  generatedAt: number;
  sessions: ViewerSessionView[];
  connections: LiveConnection[] | null;
  lines: ProviderLine[] | null;
};

/** Everything the admin Viewers panel shows: the last day's sessions, and the provider lines now. */
export async function getViewerActivity(now = Date.now()): Promise<ViewerActivity> {
  const since = new Date(now - WINDOW_MS);
  const [rows, events, connections, accounts] = await Promise.all([
    prisma.viewerSession.findMany({ where: { lastSeenAt: { gte: since } }, orderBy: { lastSeenAt: "desc" }, take: 200 }),
    // Newest first, so on a day with more than the cap it is the oldest
    // events that fall off rather than what is happening now.
    prisma.playbackEvent.findMany({ where: { at: { gte: since } }, orderBy: { at: "desc" }, take: 5000 }),
    // Polled every ten seconds by each open admin tab; Dispatcharr need not
    // be asked more often than that.
    isDispatcharrConfigured() ? cached("dispatcharr:connections", 5_000, liveConnections).catch(() => null) : Promise.resolve(null),
    isDispatcharrConfigured() ? cached("dispatcharr:accounts", 10_000, listIptvAccounts).catch(() => null) : Promise.resolve(null),
  ]);
  events.reverse();
  const geo = await locateMany(rows.map((r) => r.ip)).catch(() => new Map());

  const bySession = new Map<string, ViewerEvent[]>();
  for (const e of events) {
    const list = bySession.get(e.sessionId) ?? [];
    list.push({ at: e.at.getTime(), kind: e.kind, media: e.media, detail: e.detail, ms: e.ms });
    bySession.set(e.sessionId, list);
  }

  const sessions = rows.map((r): ViewerSessionView => {
    const evs = bySession.get(r.id) ?? [];
    let playing: PlayingNow | null = null;
    try {
      playing = r.playing ? (JSON.parse(r.playing) as PlayingNow) : null;
    } catch {
      playing = null;
    }
    const presence = presenceOf(r.lastSeenAt.getTime(), now);
    const loc = geo.get(r.ip);
    return {
      id: r.id,
      userName: r.userName,
      device: deviceLabel(r.userAgent),
      ip: r.ip,
      location: loc ? [loc.city, loc.countryCode].filter(Boolean).join(", ") || null : null,
      path: r.path,
      presence,
      startedAt: r.startedAt.getTime(),
      lastSeenAt: r.lastSeenAt.getTime(),
      // A tab that stopped reporting isn't playing anything any more.
      playing: presence === "offline" ? null : playing,
      // Recent events only: a stall an hour ago says nothing about now.
      health: sessionHealth(evs.filter((e) => e.at >= now - VERDICT_WINDOW_MS)),
      events: evs.slice(-40),
    };
  });

  const lines = accounts
    ? accounts.flatMap((a) =>
        a.lines.map((l) => ({ id: l.id, provider: a.name, line: l.name, maxStreams: l.maxStreams, viewers: l.viewers, active: l.active }))
      )
    : null;

  return { generatedAt: now, sessions, connections, lines };
}
