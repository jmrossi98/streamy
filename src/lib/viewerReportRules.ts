/**
 * The assistant's "who watched what" report, built from Streamy's own player
 * log (PlaybackEvent) and open tabs (ViewerSession). Pure; diagLocal.ts reads
 * the rows.
 *
 * Exists because the assistant once answered "who streamed recently?" from
 * Jellyfin's activity log, saw only one user, and missed another who had
 * watched a dozen episodes that week: everyone watching through Streamy is
 * here, and the last 50 Jellyfin log lines were mostly password changes.
 */

export type ViewerEventRow = { userName: string; at: Date; kind: string; media: string; sessionId: string };
export type ViewerSessionRow = { userName: string; lastSeenAt: Date; playing: string | null; userAgent: string | null };

/** A tab counts as watching now if it checked in this recently with something playing. */
export const LIVE_WINDOW_MS = 2 * 60_000;
const MAX_TITLES = 15;
const MAX_RECENT = 30;

export type ViewerReport = {
  since: string;
  note: string;
  users: {
    user: string;
    plays: number;
    titles: string[];
    firstAt: string;
    lastAt: string;
    sessions: number;
    stalls: number;
    errors: number;
  }[];
  watchingNow: { user: string; playing: string; device: string | null }[];
  recentStarts: { at: string; user: string; media: string }[];
};

function playingLabel(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return null;
    const label = v.media ?? v.title ?? v.name;
    return typeof label === "string" && label ? label : "something";
  } catch {
    return null;
  }
}

function deviceOf(ua: string | null): string | null {
  if (!ua) return null;
  if (/iPhone|iPad/i.test(ua)) return "iPhone/iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Smart-?TV|Tizen|Web0S|AFT/i.test(ua)) return "TV";
  if (/Windows|Macintosh|Linux/i.test(ua)) return "Computer";
  return null;
}

export function buildViewerReport(
  events: ViewerEventRow[],
  sessions: ViewerSessionRow[],
  since: Date,
  now: number = Date.now()
): ViewerReport {
  const byUser = new Map<
    string,
    { plays: number; titles: Map<string, number>; first: number; last: number; sessions: Set<string>; stalls: number; errors: number }
  >();
  for (const e of events) {
    const t = e.at.getTime();
    const u = byUser.get(e.userName) ?? {
      plays: 0,
      titles: new Map<string, number>(),
      first: t,
      last: t,
      sessions: new Set<string>(),
      stalls: 0,
      errors: 0,
    };
    u.first = Math.min(u.first, t);
    u.last = Math.max(u.last, t);
    u.sessions.add(e.sessionId);
    if (e.kind === "start") {
      u.plays++;
      u.titles.set(e.media, Math.max(u.titles.get(e.media) ?? 0, t));
    } else if (e.kind === "stall") u.stalls++;
    else if (e.kind === "error") u.errors++;
    byUser.set(e.userName, u);
  }

  const users = [...byUser.entries()]
    .map(([user, u]) => ({
      user,
      plays: u.plays,
      // Most recently started first.
      titles: [...u.titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TITLES).map(([m]) => m),
      firstAt: new Date(u.first).toISOString(),
      lastAt: new Date(u.last).toISOString(),
      sessions: u.sessions.size,
      stalls: u.stalls,
      errors: u.errors,
    }))
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));

  const watchingNow = sessions
    .filter((s) => now - s.lastSeenAt.getTime() <= LIVE_WINDOW_MS)
    .map((s) => ({ user: s.userName, playing: playingLabel(s.playing), device: deviceOf(s.userAgent) }))
    .filter((s): s is { user: string; playing: string; device: string | null } => s.playing !== null);

  const recentStarts = events
    .filter((e) => e.kind === "start")
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, MAX_RECENT)
    .map((e) => ({ at: e.at.toISOString(), user: e.userName, media: e.media }));

  return {
    since: since.toISOString(),
    note:
      "Everyone who watched through Streamy's player, from its own log. Viewing in a Jellyfin app directly " +
      "(not through Streamy) is not here; check api jellyfin Sessions / ActivityLog for that.",
    users,
    watchingNow,
    recentStarts,
  };
}
