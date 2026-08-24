import {
  getRadarrQueueHealth,
  getIdleWantedMovies,
  cancelRadarrDownload,
  searchRadarrMovie,
  type QueueHealth,
} from "./radarr";
import {
  getSonarrQueueHealth,
  getIdleWantedEpisodes,
  searchSonarrEpisodes,
  cancelSonarrDownload,
  searchSonarrSeries,
} from "./sonarr";

/**
 * Auto-recovery for downloads that will never finish on their own.
 *
 * A public-tracker grab can land on a dead swarm (no seeders) or a release
 * the client rejects outright, and Radarr/Sonarr will happily leave it in the
 * queue forever -- the user just sees a Download button stuck at 0%. Worse,
 * while that entry sits there Radarr refuses better releases for the same
 * title ("Quality for release in queue already meets cutoff"), so the title
 * is wedged until someone intervenes by hand.
 *
 * This detects those entries and clears the wedge automatically: drop the bad
 * release, blocklist it so it isn't immediately re-grabbed, and kick off a
 * fresh search. The user's next poll then shows a new, healthy download
 * rather than a dead one.
 */

// Grace period before touching anything: a torrent legitimately takes a
// little while to find peers and pull metadata, and we don't want to kill a
// download that was about to start moving.
const STALL_GRACE_MINUTES = 12;

// Don't re-heal the same title repeatedly -- if a fresh grab also goes bad,
// wait before trying again so we don't churn through every release on the
// indexer in a tight loop.
const REHEAL_COOLDOWN_MS = 15 * 60 * 1000;
const lastHealedAt = new Map<string, number>();

export type HealedDownload = { title: string; reason: string };

function isUnhealthy(entry: QueueHealth): boolean {
  if (entry.ageMinutes < STALL_GRACE_MINUTES) return false;
  // An explicit error from Radarr/Sonarr ("stalled with no connections",
  // "qBittorrent is reporting an error") is reason enough.
  if (entry.errorMessage) return true;
  // No error reported, but still hasn't moved a single byte well past the
  // grace period -- effectively dead too.
  return !entry.hasProgress;
}

function onCooldown(key: string): boolean {
  const last = lastHealedAt.get(key);
  return last != null && Date.now() - last < REHEAL_COOLDOWN_MS;
}

async function healOne(
  mediaType: "movie" | "show",
  entry: QueueHealth
): Promise<HealedDownload | null> {
  const key = `${mediaType}:${entry.externalId}`;
  if (onCooldown(key)) return null;
  lastHealedAt.set(key, Date.now());

  const reason = entry.errorMessage ?? "no progress";
  try {
    const cancelled =
      mediaType === "movie"
        ? await cancelRadarrDownload(entry.externalId, { blocklist: true })
        : await cancelSonarrDownload(entry.externalId, true);
    if (!cancelled) return null;

    if (mediaType === "movie") {
      await searchRadarrMovie(entry.externalId);
    } else {
      await searchSonarrSeries(entry.externalId);
    }
    console.log(`[healer] re-grabbing "${entry.title}" (${reason})`);
    return { title: entry.title, reason };
  } catch (err) {
    console.error(`[healer] failed to heal "${entry.title}":`, err);
    return null;
  }
}

/**
 * Re-searches titles Radarr still wants but has nothing in flight for.
 *
 * The queue-based healing above can only see downloads that exist. A title
 * whose search came up empty -- or whose grab was cleared without a new one
 * starting -- has nothing in the queue at all, so it stays "searching"
 * indefinitely with no search actually running. Kicking a fresh search is
 * what gets it moving again.
 */
async function healIdleWantedTitles(): Promise<HealedDownload[]> {
  const [movies, episodes] = await Promise.all([
    getIdleWantedMovies(),
    getIdleWantedEpisodes(),
  ]);
  const healed: HealedDownload[] = [];

  for (const movie of movies) {
    const key = `idle:movie:${movie.externalId}`;
    if (onCooldown(key)) continue;
    lastHealedAt.set(key, Date.now());
    try {
      await searchRadarrMovie(movie.externalId);
      console.log(`[healer] re-searching idle "${movie.title}"`);
      healed.push({ title: movie.title, reason: "wanted but nothing in flight" });
    } catch (err) {
      console.error(`[healer] idle re-search failed for "${movie.title}":`, err);
    }
  }

  // Batch the episode search: one command for everything due, rather than a
  // request per episode, so a large backlog doesn't hammer Sonarr.
  const dueEpisodes = episodes.filter((e) => {
    const key = `idle:episode:${e.episodeId}`;
    if (onCooldown(key)) return false;
    lastHealedAt.set(key, Date.now());
    return true;
  });
  if (dueEpisodes.length > 0) {
    try {
      await searchSonarrEpisodes(dueEpisodes.map((e) => e.episodeId));
      console.log(`[healer] re-searching ${dueEpisodes.length} idle episode(s)`);
      for (const e of dueEpisodes) {
        healed.push({ title: e.title, reason: "wanted but nothing in flight" });
      }
    } catch (err) {
      console.error("[healer] idle episode re-search failed:", err);
    }
  }

  return healed;
}

/** Re-grabs anything stalled or errored, and re-searches anything wanted but idle. */
export async function healStalledDownloads(): Promise<HealedDownload[]> {
  const [radarrQueue, sonarrQueue] = await Promise.all([
    getRadarrQueueHealth(),
    getSonarrQueueHealth(),
  ]);

  const healed = await Promise.all([
    ...radarrQueue.filter(isUnhealthy).map((e) => healOne("movie", e)),
    ...sonarrQueue.filter(isUnhealthy).map((e) => healOne("show", e)),
  ]);
  const idleHealed = await healIdleWantedTitles();
  return [...healed.filter((h): h is HealedDownload => h !== null), ...idleHealed];
}

// The status endpoint is polled by every viewer on every open title, so the
// scan is rate-limited globally rather than run per request.
const SCAN_INTERVAL_MS = 2 * 60 * 1000;
let lastScanAt = 0;
let inFlight: Promise<HealedDownload[]> | null = null;

/**
 * Opportunistic heal, safe to call from hot paths. Runs at most once every
 * SCAN_INTERVAL_MS across all callers, never throws, and never blocks the
 * caller on its result.
 */
export function maybeHealStalledDownloads(): void {
  if (inFlight || Date.now() - lastScanAt < SCAN_INTERVAL_MS) return;
  lastScanAt = Date.now();
  inFlight = healStalledDownloads()
    .catch((err) => {
      console.error("[healer] scan failed:", err);
      return [];
    })
    .finally(() => {
      inFlight = null;
    }) as Promise<HealedDownload[]>;
}
