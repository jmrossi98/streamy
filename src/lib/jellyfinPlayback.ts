/**
 * What has been played on Jellyfin lately -- live TV, movies, episodes -- for
 * the admin visitors log and map.
 *
 * Read straight from Jellyfin's activity log rather than from a snapshot on
 * mediabox like the sign-ins (jellyfinLogins.ts): this app already talks to
 * Jellyfin directly, and nothing has to be decided or enforced on the way.
 * The impure half; the parsing is in jellyfinPlaybackRules.ts.
 */

import { isJellyfinConfigured, jellyfinGet } from "./jellyfin";
import { getJellyfinLoginSummary } from "./jellyfinLogins";
import {
  addressToLocate,
  playbackEvents,
  playLabel,
  type ActivityEntry,
  type PlayedItem,
} from "./jellyfinPlaybackRules";
import { cached } from "./ttlCache";

// The admin page reads this for the log and again for the map.
const CACHE_TTL_MS = 60_000;
// Jellyfin keeps 30 days of activity; this covers that on a busy month.
const ACTIVITY_LIMIT = 2000;
const ITEM_CHUNK = 50;

export type JellyfinPlay = {
  id: string;
  user: string;
  /** "Live TV · CBS 8", "The Studio S1E2", "Videodrome". */
  label: string;
  device: string;
  /** The address Jellyfin saw; empty when the log no longer says. */
  ip: string;
  /** The address to place it by: the house's public one for a play on the LAN. */
  locateIp: string;
  at: string;
};

export async function getJellyfinPlays(): Promise<JellyfinPlay[]> {
  return cached("jellyfin:plays", CACHE_TTL_MS, fetchJellyfinPlays);
}

async function fetchJellyfinPlays(): Promise<JellyfinPlay[]> {
  if (!isJellyfinConfigured()) return [];
  try {
    const [log, logins] = await Promise.all([
      jellyfinGet<{ Items?: ActivityEntry[] }>(`/System/ActivityLog/Entries?limit=${ACTIVITY_LIMIT}`),
      getJellyfinLoginSummary(),
    ]);
    const events = playbackEvents(log?.Items ?? []);

    // The log sentence has only a title; the item says whether it was a
    // channel, a movie or an episode of what.
    const ids = [...new Set(events.map((e) => e.itemId).filter((x): x is string => Boolean(x)))];
    const items = new Map<string, PlayedItem>();
    for (let i = 0; i < ids.length; i += ITEM_CHUNK) {
      try {
        const page = await jellyfinGet<{ Items?: PlayedItem[] }>(
          `/Items?ids=${ids.slice(i, i + ITEM_CHUNK).join(",")}`
        );
        for (const item of page?.Items ?? []) if (item.Id) items.set(item.Id, item);
      } catch {
        // Titles fall back to the log's own wording.
      }
    }

    return events.map((e) => ({
      id: e.id,
      user: e.user,
      label: playLabel(e, e.itemId ? items.get(e.itemId) : undefined),
      device: e.device,
      ip: e.ip,
      locateIp: addressToLocate(e.ip, logins.homeIp),
      at: e.at,
    }));
  } catch (err) {
    console.error("[jellyfin] getJellyfinPlays failed:", err);
    return [];
  }
}
