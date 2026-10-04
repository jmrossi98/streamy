/**
 * Turns Jellyfin's activity log into "who played what, from where" rows.
 *
 * Pure, so the awkward parts can be tested without a Jellyfin server: the log
 * describes each event in an English sentence rather than in fields, a play
 * carries no address (only the session that preceded it does), and a live TV
 * channel that drops and re-tunes writes a fresh "is playing" line every time.
 */

export type ActivityEntry = {
  Id?: number;
  Name?: string;
  ShortOverview?: string;
  Type?: string;
  ItemId?: string;
  Date?: string;
  UserId?: string;
};

export type PlaybackEvent = {
  /** Stable enough for a React key: the activity log's own id of the first start. */
  id: string;
  user: string;
  /** The title as the log sentence gave it; the caller may know a better one. */
  title: string;
  device: string;
  itemId: string | null;
  /** Empty when no session entry for this user and device is still in the log. */
  ip: string;
  /** When the (first) play started. */
  at: string;
};

/**
 * Starts of the same thing on the same device this close together are one
 * sitting, not several: a Roku re-tuning a dropped channel logged six plays of
 * one game in twenty-five minutes on 2026-10-04.
 */
export const SAME_SITTING_MS = 30 * 60 * 1000;

/** "jaker is playing The Oner on Chrome" -> its three parts. */
export function parsePlaying(name: string): { user: string; title: string; device: string } | null {
  const marker = " is playing ";
  const start = name.indexOf(marker);
  // The device is after the LAST " on ": titles contain the word, devices
  // essentially never do ("Twin Peaks: Fire Walk on Me on Chrome").
  const end = name.lastIndexOf(" on ");
  if (start <= 0 || end < start + marker.length) return null;
  const title = name.slice(start + marker.length, end).trim();
  const device = name.slice(end + 4).trim();
  if (!title || !device) return null;
  return { user: name.slice(0, start), title, device };
}

/** "jaker is online from Chrome" / "... has disconnected from Chrome" -> user and device. */
export function parseSession(name: string): { user: string; device: string } | null {
  for (const marker of [" is online from ", " has disconnected from "]) {
    const at = name.indexOf(marker);
    if (at > 0) {
      const device = name.slice(at + marker.length).trim();
      return device ? { user: name.slice(0, at), device } : null;
    }
  }
  return null;
}

function sessionIp(overview: string | undefined): string | null {
  const m = /IP address:\s*(\S+)/.exec(overview ?? "");
  return m ? m[1] : null;
}

/**
 * One row per sitting, newest first.
 *
 * A play's address is that of the latest session entry for the same user and
 * device at or before it; failing that, the earliest one after it (the log is
 * a rolling window, so the session start can have aged out while its end is
 * still there).
 */
export function playbackEvents(entries: ActivityEntry[]): PlaybackEvent[] {
  const time = (e: ActivityEntry) => new Date(e.Date ?? "").getTime();
  const sorted = entries.filter((e) => !Number.isNaN(time(e))).sort((a, b) => time(a) - time(b));

  const sessions = new Map<string, { at: number; ip: string }[]>();
  for (const e of sorted) {
    if (e.Type !== "SessionStarted" && e.Type !== "SessionEnded") continue;
    const who = parseSession(e.Name ?? "");
    const ip = sessionIp(e.ShortOverview);
    if (!who || !ip) continue;
    const key = `${e.UserId ?? who.user}|${who.device}`;
    sessions.set(key, [...(sessions.get(key) ?? []), { at: time(e), ip }]);
  }
  const ipFor = (key: string, at: number): string => {
    const list = sessions.get(key) ?? [];
    const before = list.filter((s) => s.at <= at).at(-1);
    return (before ?? list[0])?.ip ?? "";
  };

  const out: PlaybackEvent[] = [];
  const lastSeen = new Map<string, number>();
  for (const e of sorted) {
    if (e.Type !== "VideoPlayback" && e.Type !== "VideoPlaybackStopped") continue;
    const stopped = e.Type === "VideoPlaybackStopped";
    const play = parsePlaying((e.Name ?? "").replace(" has finished playing ", " is playing "));
    if (!play) continue;
    const who = `${e.UserId ?? play.user}|${play.device}`;
    const sitting = `${who}|${e.ItemId ?? play.title}`;
    const at = time(e);
    const previous = lastSeen.get(sitting);
    lastSeen.set(sitting, at);
    // A stop only extends the sitting it belongs to; it is never a row itself.
    if (stopped || (previous !== undefined && at - previous < SAME_SITTING_MS)) continue;
    out.push({
      id: `jfplay:${e.Id ?? `${e.Date}:${sitting}`}`,
      user: play.user,
      title: play.title,
      device: play.device,
      itemId: e.ItemId ?? null,
      ip: ipFor(who, at),
      at: new Date(at).toISOString(),
    });
  }
  return out.reverse();
}

export type PlayedItem = {
  Id?: string;
  Name?: string;
  Type?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
};

/** What to call a play in the log: live TV said as such, an episode with its show. */
export function playLabel(event: Pick<PlaybackEvent, "title">, item: PlayedItem | undefined): string {
  if (!item) return event.title;
  if (item.Type === "TvChannel") return `Live TV · ${item.Name ?? event.title}`;
  if (item.Type === "Episode" && item.SeriesName) {
    const number =
      item.ParentIndexNumber != null && item.IndexNumber != null
        ? ` S${item.ParentIndexNumber}E${item.IndexNumber}`
        : "";
    return `${item.SeriesName}${number}`;
  }
  return item.Name ?? event.title;
}

/**
 * An address on the house's own network -- the one case where "can't be
 * geolocated" still has a known answer, because the server is in that house.
 *
 * Deliberately not 172.16/12 (Docker's bridge: a connection that came through
 * a proxy and lost its real address could be from anywhere) and not the
 * tailnet's 100.64/10 (a phone on Tailscale can be in another country).
 */
export function isHomeLanAddress(ip: string): boolean {
  return /^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip) || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

/** The address to geolocate a play by: the house's public one for a LAN play. */
export function addressToLocate(ip: string, homeIp: string | null): string {
  return homeIp && isHomeLanAddress(ip) ? homeIp : ip;
}
