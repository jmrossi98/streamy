import {
  idleBackoffMs,
  isPermanentlyBlocked,
  isUnhealthy,
  REHEAL_COOLDOWN_MS,
  shouldBlocklist,
  shouldSearchImmediately,
  type BadReleaseReason,
} from "./downloadHealthRules";
import {
  getRadarrQueueHealth,
  getIdleWantedMovies,
  cancelRadarrDownload,
  cancelRadarrQueueItem,
  searchRadarrMovie,
  expireRadarrBlocklist,
  type QueueHealth,
} from "./radarr";
import {
  getSonarrQueueHealth,
  getIdleWantedEpisodes,
  searchSonarrEpisodes,
  cancelSonarrDownload,
  cancelSonarrQueueItem,
  searchSonarrSeries,
  expireSonarrBlocklist,
} from "./sonarr";
import { countRecentRejections, getPermanentBlocks, recordRejection } from "./rejectedReleases";

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

// Per-title heal bookkeeping. The escalation policy itself lives in
// downloadHealthRules.ts so it can be tested without this file's clients.
const lastHealedAt = new Map<string, number>();
const idleTries = new Map<string, number>();

export type HealedDownload = { title: string; reason: string };

function onCooldown(key: string): boolean {
  const last = lastHealedAt.get(key);
  return last != null && Date.now() - last < REHEAL_COOLDOWN_MS;
}

/** Cooldown for the idle pass, which escalates; the queue pass does not. */
function onIdleCooldown(key: string): boolean {
  const last = lastHealedAt.get(key);
  if (last == null) return false;
  return Date.now() - last < idleBackoffMs(idleTries.get(key) ?? 0);
}

async function healOne(
  mediaType: "movie" | "show",
  entry: QueueHealth
): Promise<HealedDownload | null> {
  const key = `${mediaType}:${entry.externalId}`;
  if (onCooldown(key)) return null;
  lastHealedAt.set(key, Date.now());

  const reason = entry.errorMessage ?? "no progress";
  // Blocklisting is permanent, so reserve it for releases that genuinely
  // failed -- a corrupt or unusable download the client rejected. A stall is
  // usually about conditions, not the release: a VPN reconnect or a brief
  // peer drought. Blocklisting those poisoned the best-seeded releases and
  // pushed later searches onto steadily worse ones.
  const failed = shouldBlocklist(entry.errorMessage);
  try {
    const cancelled =
      mediaType === "movie"
        ? await cancelRadarrDownload(entry.externalId, { blocklist: failed })
        : await cancelSonarrDownload(entry.externalId, failed);
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

type UnsafeEntry = QueueHealth & { unsafe: BadReleaseReason };

/**
 * Throws away a finished download that turned out not to be media, and looks
 * for another release straight away.
 *
 * Radarr/Sonarr refuse to import an executable but leave it in the queue, so
 * without this it sat at 100% forever -- a fake "1080p WEB-DL" whose only file
 * was a 1.1 GB .exe. Unlike a stall, this is never about conditions: the
 * release itself is bad, so it is blocklisted for good (see the expiry skip in
 * healStalledDownloads) and the title's next-best release is fetched at once.
 * If that one is fake too it goes the same way, so every alternative gets its
 * turn; when none is left the title reports "no release found" along with why.
 */
async function rejectUnsafe(
  mediaType: "movie" | "show",
  entry: UnsafeEntry
): Promise<HealedDownload | null> {
  try {
    // Record before removing: the record is what keeps the blocklist entry
    // from expiring, and it is idempotent so a failed removal that retries on
    // the next scan does not double-count. A DB failure must not stop the
    // removal though -- getting the file off the disk matters more than the
    // bookkeeping.
    await recordRejection({
      mediaType,
      externalId: entry.externalId,
      releaseTitle: entry.title,
      downloadId: entry.downloadId,
      reason: entry.unsafe,
    }).catch((err) => console.error("[healer] could not record rejection:", err));

    const removed =
      mediaType === "movie"
        ? await cancelRadarrQueueItem(entry.queueId, { blocklist: true })
        : await cancelSonarrQueueItem(entry.queueId, { blocklist: true });
    if (!removed) return null;

    const recent = await countRecentRejections(mediaType, entry.externalId).catch(() => 0);
    if (shouldSearchImmediately(recent)) {
      if (mediaType === "movie") {
        await searchRadarrMovie(entry.externalId);
        // This scan's idle-title pass would otherwise fire a second, identical
        // search a moment later.
        lastHealedAt.set(`idle:movie:${entry.externalId}`, Date.now());
      } else if (entry.episodeId != null) {
        await searchSonarrEpisodes([entry.episodeId]);
        lastHealedAt.set(`idle:episode:${entry.episodeId}`, Date.now());
      } else {
        await searchSonarrSeries(entry.externalId);
      }
    }
    console.warn(`[healer] rejected unsafe release "${entry.title}" (${entry.unsafe})`);
    return { title: entry.title, reason: `unsafe release removed (${entry.unsafe})` };
  } catch (err) {
    console.error(`[healer] failed to reject "${entry.title}":`, err);
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

  // A title that has dropped off the wanted list got what it needed (or was
  // cancelled), so its escalation is forgotten. Without this, a title that
  // succeeds after several failures would come back on a 4-hour cooldown the
  // next time it legitimately needs a nudge.
  const stillWanted = new Set([
    ...movies.map((m) => `idle:movie:${m.externalId}`),
    ...episodes.map((e) => `idle:episode:${e.episodeId}`),
  ]);
  for (const key of [...idleTries.keys()]) {
    if (!stillWanted.has(key)) idleTries.delete(key);
  }

  for (const movie of movies) {
    const key = `idle:movie:${movie.externalId}`;
    if (onIdleCooldown(key)) continue;
    lastHealedAt.set(key, Date.now());
    idleTries.set(key, (idleTries.get(key) ?? 0) + 1);
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
    if (onIdleCooldown(key)) return false;
    lastHealedAt.set(key, Date.now());
    idleTries.set(key, (idleTries.get(key) ?? 0) + 1);
    return true;
  });
  if (dueEpisodes.length > 0) {
    try {
      await searchSonarrEpisodes(dueEpisodes.map((e) => e.episodeId));
      // Attempt counts logged so a title quietly backing off to daily is
      // visible in the log rather than looking like the healer stopped.
      console.log(
        `[healer] re-searching ${dueEpisodes.length} idle episode(s): ` +
          dueEpisodes
            .map((e) => `${e.title} (try ${idleTries.get(`idle:episode:${e.episodeId}`) ?? 1})`)
            .join(", ")
      );
      for (const e of dueEpisodes) {
        healed.push({ title: e.title, reason: "wanted but nothing in flight" });
      }
    } catch (err) {
      console.error("[healer] idle episode re-search failed:", err);
    }
  }

  return healed;
}

// How long a blocklisted release stays blocked. Long enough that a genuinely
// bad release isn't re-grabbed immediately, short enough that a good one
// blocked by a transient stall becomes eligible again on its own.
const BLOCKLIST_TTL_HOURS = 6;

/** Re-grabs anything stalled or errored, and re-searches anything wanted but idle. */
export async function healStalledDownloads(): Promise<HealedDownload[]> {
  // Do this first so the searches below can see releases whose block has aged
  // out, rather than settling for a worse-seeded alternative. Releases we
  // rejected as unsafe are exempt: they were never blocked by conditions, and
  // expiring them would just let the same fake be grabbed again. If the list of
  // those can't be read, skip the expiry entirely rather than risk that.
  try {
    const rejected = await getPermanentBlocks();
    const keep = (record: Parameters<typeof isPermanentlyBlocked>[0]) =>
      isPermanentlyBlocked(record, rejected);
    await Promise.all([
      expireRadarrBlocklist(BLOCKLIST_TTL_HOURS, keep),
      expireSonarrBlocklist(BLOCKLIST_TTL_HOURS, keep),
    ]);
  } catch (err) {
    console.error("[healer] skipped blocklist expiry (could not read rejected releases):", err);
  }

  const [radarrQueue, sonarrQueue] = await Promise.all([
    getRadarrQueueHealth(),
    getSonarrQueueHealth(),
  ]);

  const isUnsafe = (e: QueueHealth): e is UnsafeEntry => e.unsafe != null;
  // An unsafe entry is dealt with on its own path and kept out of the stall
  // rules below: those re-grab without blocklisting, which for a fake would
  // just fetch the same one again.
  const healed = await Promise.all([
    ...radarrQueue.filter(isUnsafe).map((e) => rejectUnsafe("movie", e)),
    ...sonarrQueue.filter(isUnsafe).map((e) => rejectUnsafe("show", e)),
    ...radarrQueue.filter((e) => !e.unsafe && isUnhealthy(e)).map((e) => healOne("movie", e)),
    ...sonarrQueue.filter((e) => !e.unsafe && isUnhealthy(e)).map((e) => healOne("show", e)),
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
