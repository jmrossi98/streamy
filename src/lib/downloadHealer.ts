import {
  idleBackoffMs,
  isPermanentlyBlocked,
  isUnhealthy,
  isImportStuck,
  isDeadSwarm,
  isMetadataDead,
  IMPORT_STUCK_MINUTES,
  pickIdleEpisodeBatch,
  REHEAL_COOLDOWN_MS,
  shouldBlocklist,
  shouldBlocklistStalled,
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
  outstandingSearches,
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
/** Consecutive stall-heals per episode, for the escalation in healOne. */
const stallTries = new Map<string, number>();
// Consecutive passes a title has been missing from the idle lists. Prevents
// one transient empty read from resetting a title's escalation.
const absentPasses = new Map<string, number>();

function stillWantedKeys(
  movies: { externalId: number }[],
  episodes: { episodeId: number }[]
): Set<string> {
  return new Set([
    ...movies.map((m) => `idle:movie:${m.externalId}`),
    ...episodes.map((e) => `idle:episode:${e.episodeId}`),
  ]);
}

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
  entry: QueueHealth & { torrentState?: string | null },
  swarm: Map<string, { swarmSeeds: number; connectedSeeds: number }> = new Map()
): Promise<HealedDownload | null> {
  // Keyed per episode (or movie), not per queue entry.
  //
  // It used to include entry.queueId, which looks right -- a series can have
  // several episodes in flight, and keying on the series put its siblings on
  // cooldown too -- but a re-grab produces a *new* queue id, so the cooldown
  // never applied to the thing it existed to slow down. A release that stalls
  // on every attempt was healed in a tight loop: The Wire S01E12 was grabbed
  // five times and S01E06 four, each within minutes.
  //
  // The episode id is stable across re-grabs and still leaves sibling episodes
  // alone, which is what the original comment was actually asking for.
  const key = `${mediaType}:${entry.externalId}:${entry.episodeId ?? "series"}`;
  if (onCooldown(key)) return null;
  lastHealedAt.set(key, Date.now());

  // How many times this same episode has been healed for a stall. A single
  // stall is usually conditions -- a VPN reconnect, a brief peer drought -- and
  // blocklisting for that poisons good releases. Repeated stalls of the same
  // thing are the release itself, and cancelling without blocklisting just
  // hands Sonarr the same dead torrent to pick again.
  const stalls = (stallTries.get(key) ?? 0) + 1;
  stallTries.set(key, stalls);

  const reason = entry.errorMessage ?? "no progress";
  // Blocklisting is permanent, so reserve it for releases that genuinely
  // failed -- a corrupt or unusable download the client rejected. A stall is
  // usually about conditions, not the release: a VPN reconnect or a brief
  // peer drought. Blocklisting those poisoned the best-seeded releases and
  // pushed later searches onto steadily worse ones.
  const deadSwarm =
    isMetadataDead(entry) ||
    isDeadSwarm(entry.downloadId ? swarm.get(entry.downloadId.toLowerCase()) : undefined);
  const failed = shouldBlocklistStalled(entry.errorMessage, stalls, deadSwarm);
  try {
    // Cancel this entry, never the title's whole queue.
    //
    // cancelSonarrDownload takes a *series* id and removes every queue entry
    // belonging to it. One dead special therefore killed every other episode
    // of the same series that happened to be downloading -- observed on
    // Gurren Lagann, where a 0-seed fansub torrent repeatedly took out the
    // movie at 26%, 29%, then 44%, each time resetting it to zero. A series
    // with several things in flight could never finish any of them.
    //
    // rejectUnsafe already did this correctly per entry; healOne did not.
    const cancelled =
      mediaType === "movie"
        ? await cancelRadarrQueueItem(entry.queueId, { blocklist: failed })
        : await cancelSonarrQueueItem(entry.queueId, { blocklist: failed, keepWanted: true });
    if (!cancelled) return null;

    // Re-search only what was just cancelled. A SeriesSearch re-grabs every
    // missing episode, which on a series with 21 monitored specials means 21
    // new grabs for one failed download.
    if (mediaType === "movie") {
      await searchRadarrMovie(entry.externalId);
      lastHealedAt.set(`idle:movie:${entry.externalId}`, Date.now());
    } else if (entry.episodeId != null) {
      await searchSonarrEpisodes([entry.episodeId]);
      lastHealedAt.set(`idle:episode:${entry.episodeId}`, Date.now());
    } else {
      // No episode id (an unmatched or season-pack entry): series search is
      // the only option left, and is correct there.
      await searchSonarrSeries(entry.externalId);
    }
    console.log(
      `[healer] re-grabbing "${entry.title}" (${reason})` +
        (failed ? ` -- blocklisted after ${stalls} stalls` : ` -- stall ${stalls}`)
    );
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
        : await cancelSonarrQueueItem(entry.queueId, { blocklist: true, keepWanted: true });
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

// When each queue entry was first seen stuck unable to import, by queue id.
const importStuckSince = new Map<number, number>();

/**
 * Replaces a finished download that has been failing to import for
 * IMPORT_STUCK_MINUTES -- see isImportStuck. Blocklisted (with the usual
 * expiry) because the file itself is the problem, and searched again at once.
 */
async function replaceStuckImport(
  mediaType: "movie" | "show",
  entry: QueueHealth
): Promise<HealedDownload | null> {
  try {
    const removed =
      mediaType === "movie"
        ? await cancelRadarrQueueItem(entry.queueId, { blocklist: true })
        : await cancelSonarrQueueItem(entry.queueId, { blocklist: true, keepWanted: true });
    if (!removed) return null;
    importStuckSince.delete(entry.queueId);
    if (mediaType === "movie") {
      await searchRadarrMovie(entry.externalId);
      lastHealedAt.set(`idle:movie:${entry.externalId}`, Date.now());
    } else if (entry.episodeId != null) {
      await searchSonarrEpisodes([entry.episodeId]);
      lastHealedAt.set(`idle:episode:${entry.episodeId}`, Date.now());
    } else {
      await searchSonarrSeries(entry.externalId);
    }
    const why = entry.importProblem ?? entry.trackedDownloadState ?? "import stuck";
    console.warn(`[healer] replacing "${entry.title}": finished but cannot import (${why})`);
    return { title: entry.title, reason: `finished but could not import: ${why}` };
  } catch (err) {
    console.error(`[healer] failed to replace stuck import "${entry.title}":`, err);
    return null;
  }
}

/** Entries stuck importing for long enough to act on; updates the clock. */
function dueStuckImports(entries: QueueHealth[], now = Date.now()): QueueHealth[] {
  const seen = new Set<number>();
  const due: QueueHealth[] = [];
  for (const e of entries) {
    if (e.unsafe || !isImportStuck(e)) continue;
    seen.add(e.queueId);
    const since = importStuckSince.get(e.queueId) ?? now;
    importStuckSince.set(e.queueId, since);
    if (now - since >= IMPORT_STUCK_MINUTES * 60_000) due.push(e);
  }
  // An entry that imported, or left the queue, starts from zero if it is back.
  for (const id of [...importStuckSince.keys()]) if (!seen.has(id)) importStuckSince.delete(id);
  return due;
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

  // Escalation is forgotten only for titles that have genuinely left the
  // wanted list for a while -- not the instant they stop appearing.
  //
  // The idle lists exclude anything currently in the download queue, so the
  // first version of this pruned the counter for every title that started
  // downloading. A queue that briefly reads empty -- which happens each time
  // the pass above cancels something -- then made an active download look
  // idle with tries reset to zero, so it was re-searched at the 15-minute
  // base interval instead of its real backoff. That is how a download at
  // "try 3" reappeared as "try 1" and got grabbed again.
  //
  // Requiring two consecutive absences costs one extra cycle of memory and
  // makes a single transient read harmless.
  for (const key of [...idleTries.keys()]) {
    if (stillWantedKeys(movies, episodes).has(key)) {
      absentPasses.delete(key);
      continue;
    }
    const misses = (absentPasses.get(key) ?? 0) + 1;
    if (misses >= 2) {
      idleTries.delete(key);
      absentPasses.delete(key);
    } else {
      absentPasses.set(key, misses);
    }
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

  // Episodes already queued for an ordered search are left alone.
  //
  // This pass fires one EpisodeSearch for everything due at once, and the
  // wanted list arrives newest-aired first. For a freshly requested season
  // that is every episode of it, so the batch grabbed the season from the
  // finale backwards and buried the ordered queue working forwards from
  // episode 1 -- the season downloaded in reverse. These episodes are not
  // idle, they are waiting their turn; the drain owns them, and drops any that
  // fail three times, at which point this pass sees them again.
  //
  // Loaded here rather than imported at the top so this module's unit tests
  // stay free of the database (see __tests__/pureTestGraph.test.ts).
  // The import is inside the try, not just the call: when the generated Prisma
  // client is absent the `import()` itself throws, which took the whole heal
  // pass down rather than costing it this one refinement.
  let queued = new Set<number>();
  try {
    const { pendingSearchIds } = await import("./pendingEpisodeSearch");
    queued = new Set(await pendingSearchIds());
  } catch (err) {
    // Worst case the ordered queue is re-searched in parallel, which is the
    // old behaviour -- not a reason to stop healing stalled downloads.
    console.error("[healer] could not read the ordered search queue:", err);
  }

  // Re-searching idle episodes is background work, and it yields to anything
  // someone asked for: while requested episodes are waiting in the ordered
  // queue, or any search is already running, this pass adds nothing. Sonarr
  // runs searches one after another, so a healer search started now is time
  // a fresh request spends waiting behind it. Unreadable counts as busy.
  const [busy, pending] = await Promise.all([
    outstandingSearches(),
    import("./pendingEpisodeSearch")
      .then((m) => m.pendingSearchStats())
      .catch(() => null),
  ]);
  if (busy !== 0 || (pending?.total ?? 0) > 0) {
    return healed;
  }

  // A small batch per pass rather than one command for everything due -- see
  // IDLE_EPISODE_BATCH for what the unbounded version cost.
  const dueEpisodes = pickIdleEpisodeBatch(
    episodes.filter((e) => !queued.has(e.episodeId)),
    (e) => idleTries.get(`idle:episode:${e.episodeId}`) ?? 0,
    (e) => onIdleCooldown(`idle:episode:${e.episodeId}`)
  );
  for (const e of dueEpisodes) {
    const key = `idle:episode:${e.episodeId}`;
    lastHealedAt.set(key, Date.now());
    idleTries.set(key, (idleTries.get(key) ?? 0) + 1);
  }
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

  // Swarm seed counts by info hash, so a stalled torrent nobody can seed is
  // blocklisted on its first stall. Unreadable qBittorrent just means no
  // extra knowledge -- the usual stall rules still apply.
  const swarm = new Map<string, { swarmSeeds: number; connectedSeeds: number; state: string }>();
  try {
    const { getTorrentHealth } = await import("./qbittorrent");
    for (const t of (await getTorrentHealth()) ?? []) if (t.hash) swarm.set(t.hash, t);
  } catch (err) {
    console.error("[healer] could not read torrent swarms:", err);
  }

  // qBittorrent's own state on each torrent entry, so "queued" in Sonarr can
  // be told apart from "still fetching metadata" (see isWaitingItsTurn).
  const withTorrentState = (e: QueueHealth) => ({
    ...e,
    torrentState:
      e.protocol === "torrent" && e.downloadId ? swarm.get(e.downloadId.toLowerCase())?.state ?? null : null,
  });

  const isUnsafe = (e: QueueHealth): e is UnsafeEntry => e.unsafe != null;
  // An unsafe entry is dealt with on its own path and kept out of the stall
  // rules below: those re-grab without blocklisting, which for a fake would
  // just fetch the same one again.
  const healed = await Promise.all([
    ...radarrQueue.filter(isUnsafe).map((e) => rejectUnsafe("movie", e)),
    ...sonarrQueue.filter(isUnsafe).map((e) => rejectUnsafe("show", e)),
    ...radarrQueue.map(withTorrentState).filter((e) => !e.unsafe && isUnhealthy(e)).map((e) => healOne("movie", e, swarm)),
    ...sonarrQueue.map(withTorrentState).filter((e) => !e.unsafe && isUnhealthy(e)).map((e) => healOne("show", e, swarm)),
    ...dueStuckImports([...radarrQueue, ...sonarrQueue]).map((e) =>
      replaceStuckImport(radarrQueue.includes(e) ? "movie" : "show", e)
    ),
  ]);
  // Episodes no longer in either queue have finished or been removed, so their
  // stall count is history. Without this the map grows for the life of the
  // process and a release that recovered would still be blocklisted on its
  // next single stall.
  const live = new Set(
    [...radarrQueue, ...sonarrQueue].map(
      (e) => `${e.episodeId == null ? "movie" : "show"}:${e.externalId}:${e.episodeId ?? "series"}`
    )
  );
  for (const key of [...stallTries.keys()]) {
    if (!live.has(key)) stallTries.delete(key);
  }

  // New content ahead of upgrades in SABnzbd -- see sabPriorityRules.ts.
  // Best-effort: a failure here must not cost the rest of the pass.
  try {
    const { prioritizeNewDownloads } = await import("./sabnzbd");
    const changed = await prioritizeNewDownloads(
      [...radarrQueue, ...sonarrQueue]
        .filter((e) => e.protocol === "usenet" && e.downloadId)
        .map((e) => ({ downloadId: e.downloadId!, isUpgrade: e.isUpgrade }))
    );
    if (changed > 0) console.log(`[healer] reordered ${changed} SABnzbd job(s): new content before upgrades`);
  } catch (err) {
    console.error("[healer] could not reorder SABnzbd:", err);
  }

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
