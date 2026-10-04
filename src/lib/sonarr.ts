/**
 * Sonarr API client (server-side only). Set SONARR_URL/SONARR_API_KEY/
 * SONARR_ROOT_FOLDER/SONARR_QUALITY_PROFILE_ID in env to enable.
 * Sonarr is keyed by TVDB id, not TMDB — requestShow() resolves the TVDB id
 * via TMDB's own external_ids endpoint first, so this is still deterministic
 * ID matching, never fuzzy title search.
 */

import { episodeSearchesToCancel, seriesSearchesToCancel, type ArrCommand } from "./cancelRules";
import { earliestDownloaded } from "./playStartRules";
import {
  countBlockingSearches,
  planSearches,
  seriesRefreshPending,
  type SearchCandidate,
  type SonarrCommand,
} from "./searchQueueRules";
import { cached } from "./ttlCache";
import { getTvExternalIds } from "./tmdb";
import { deleteTorrents } from "./qbittorrent";
import { classifyBadRelease, type BlocklistRecord } from "./downloadHealthRules";
import { expireBlocklist, QUEUE_PAGE_SIZE, toQueueHealth } from "./radarr";
import { computeProgress } from "./radarr";
import { normalizeProtocol, type DownloadProtocol } from "./radarr";
import { IMPORTING_STATES } from "./radarr";
import { isConfidenceBlockedQueueItem, type QueueItemForImportCheck } from "./radarr";
import { isSearchStale } from "./radarr";
import {
  overrideLanguages,
  pickUnmatchedEpisode,
  pickUnmatchedSeasonPack,
  type SeasonRelease,
} from "./seasonDeepSearchRules";
import { fileBaseName } from "./radarr";
import { protocolsFromHistory, type HistoryEvent } from "./historyProtocolRules";
import { readDownloadRouting, type DownloadRouting } from "./radarr";
import { resolveQualityProfileId, type QualityTier } from "./qualityTier";
import type {
  MediaRequestStatus,
  LiveStatus,
  ActiveDownload,
  CompletedDownload,
  QueueHealth,
  RadarrHealthIssue,
} from "./radarr";

const SONARR_URL = process.env.SONARR_URL?.replace(/\/$/, "");
const SONARR_API_KEY = process.env.SONARR_API_KEY;
const SONARR_ROOT_FOLDER = process.env.SONARR_ROOT_FOLDER;
const SONARR_QUALITY_PROFILE_ID = process.env.SONARR_QUALITY_PROFILE_ID;
// Unset until a 4K profile is configured; every tier then resolves to HD.
const SONARR_QUALITY_PROFILE_ID_4K = process.env.SONARR_QUALITY_PROFILE_ID_4K;

export function isSonarrConfigured(): boolean {
  return !!(
    SONARR_URL &&
    SONARR_API_KEY &&
    SONARR_ROOT_FOLDER &&
    SONARR_QUALITY_PROFILE_ID &&
    !Number.isNaN(Number(SONARR_QUALITY_PROFILE_ID))
  );
}

// Bridges the gap between "we just told Sonarr to search this episode" and
// Sonarr actually updating the episode's own lastSearchTime, which lags
// behind the request -- confirmed live: EpisodeSearch is a queued async
// command, so lastSearchTime still reads whenever the *previous* search
// happened until this new one is actually processed. For an episode that had
// already gone stale from an earlier failed attempt, that meant a fresh
// "Search again" (or a first-time request landing on an episode Sonarr's own
// RSS pass had already tried) read isSearchStale() as true again for as long
// as the new command took to get to it -- reported live as "Severance E5
// said no releases found, then a few moments later showed 68%" for a search
// that had been running the entire time. Cleared lazily (checked on read, no
// separate sweep needed): each check either uses an entry or evicts it once
// stale, so this never grows unbounded over a long-running process.
const RECENT_SEARCH_GRACE_MS = 3 * 60 * 1000;
const recentlyTriggeredSearches = new Map<number, number>();

// Exported for tests only -- every real call site is in this file.
export function markEpisodeSearchTriggered(episodeId: number): void {
  recentlyTriggeredSearches.set(episodeId, Date.now());
}

export function hasRecentlyTriggeredSearch(episodeId: number): boolean {
  const at = recentlyTriggeredSearches.get(episodeId);
  if (at == null) return false;
  if (Date.now() - at > RECENT_SEARCH_GRACE_MS) {
    recentlyTriggeredSearches.delete(episodeId);
    return false;
  }
  return true;
}

// Unbounded before this. A large legacy show (e.g. a hundred-plus episode
// back catalog) makes Sonarr do real synchronous work fetching metadata for
// every episode when it's added, which can genuinely take a while -- but with
// no timeout anywhere in the chain (this call, or the client's fetch behind
// it), that showed up as "stuck on starting" forever with zero feedback
// rather than a bounded wait or a clear error.
const ARR_FETCH_TIMEOUT_MS = 15_000;

/**
 * Backoff for a read that could not connect at all. Sonarr's web server
 * saturates for short stretches under search load -- its accept queue was
 * measured full (513 waiting) while the process was still alive -- and a
 * single attempt turned that into a request that failed outright and showed
 * "Retry". Two more tries over about five seconds ride it out.
 */
const CONNECT_RETRY_DELAYS_MS = [1_500, 4_000];

function isConnectFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { cause?: { code?: string } }).cause?.code ?? "";
  return err.message === "fetch failed" || /ECONN|UND_ERR_CONNECT|EHOSTUNREACH|ETIMEDOUT/.test(code);
}

async function sonarrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only reads are retried. Repeating a POST whose response was lost could
  // start the same search twice, which is worse than asking the viewer.
  const method = (init?.method ?? "GET").toUpperCase();
  const delays = method === "GET" ? CONNECT_RETRY_DELAYS_MS : [];
  let res: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await fetch(`${SONARR_URL}${path}`, {
        ...init,
        headers: {
          "X-Api-Key": SONARR_API_KEY!,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        signal: init?.signal ?? AbortSignal.timeout(ARR_FETCH_TIMEOUT_MS),
      });
      break;
    } catch (err) {
      if (attempt >= delays.length || !isConnectFailure(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sonarr API error: ${res.status} ${body}`.trim());
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Any episode file on disk means "available"; otherwise check the active queue. */
/**
 * "requested" (still actively searching) vs "noReleaseFound" (searched, came
 * up empty) -- see the Radarr twin (isSearchStale) for the full rationale.
 * A series has no single lastSearchTime of its own, so this rolls its
 * monitored, fileless episodes up: only reports noReleaseFound once *every*
 * one of them has an individually stale search, so a show that's still
 * mid-search on some episodes doesn't get flagged early.
 */
async function resolveSonarrStatus(series: {
  id: number;
  statistics?: { episodeFileCount?: number };
}): Promise<MediaRequestStatus> {
  if ((series.statistics?.episodeFileCount ?? 0) > 0) return "available";
  const queue = await sonarrFetch<{ records: { seriesId: number }[] }>(`/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`);
  if (queue.records.some((r) => r.seriesId === series.id)) return "downloading";

  const episodes = await sonarrFetch<
    { monitored: boolean; hasFile: boolean; lastSearchTime?: string | null }[]
  >(`/api/v3/episode?seriesId=${series.id}`);
  const wanted = episodes.filter((e) => e.monitored && !e.hasFile);
  const allStale = wanted.length > 0 && wanted.every((e) => isSearchStale(e.lastSearchTime));
  return allStale ? "noReleaseFound" : "requested";
}

/** Total size on disk across every episode file Sonarr is tracking. */
export async function getSonarrTvSize(): Promise<number | null> {
  if (!isSonarrConfigured()) return null;
  try {
    const series = await sonarrFetch<{ statistics?: { sizeOnDisk?: number } }[]>(
      "/api/v3/series"
    );
    return series.reduce((sum, s) => sum + (s.statistics?.sizeOnDisk ?? 0), 0);
  } catch (err) {
    console.error("[sonarr] getSonarrTvSize failed:", err);
    return null;
  }
}

/**
 * Re-derives a show's live status straight from Sonarr, bypassing whatever
 * Streamy's own MediaRequest row currently says. Used to catch downloads that
 * were cancelled or removed directly in Sonarr/qBittorrent (outside
 * Streamy's request flow), since the webhook that would normally flip status
 * never fires for that.
 */
export async function getSonarrLiveStatus(sonarrId: number): Promise<LiveStatus | null> {
  if (!isSonarrConfigured()) return null;
  try {
    const series = await sonarrFetch<{
      id: number;
      monitored: boolean;
      statistics?: { episodeFileCount?: number };
    }>(`/api/v3/series/${sonarrId}`);
    if ((series.statistics?.episodeFileCount ?? 0) > 0) return "available";
    // Nothing monitored means Sonarr will never search -- reporting that as
    // "searching" leaves the button spinning forever. See the Radarr twin.
    if (!series.monitored) return "cancelled";
    return resolveSonarrStatus(series);
  } catch (err) {
    console.error(`[sonarr] getSonarrLiveStatus failed for ${sonarrId}:`, err);
    return null;
  }
}

/** Live download percent (0-100) for a series currently in Sonarr's active queue. */
export async function getSonarrDownloadProgress(sonarrId: number): Promise<number | null> {
  if (!isSonarrConfigured()) return null;
  try {
    const queue = await sonarrFetch<{ records: { seriesId: number; size: number; sizeleft: number }[] }>(
      `/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`
    );
    const entry = queue.records.find((r) => r.seriesId === sonarrId);
    if (!entry || !entry.size) return null;
    return Math.round(((entry.size - entry.sizeleft) / entry.size) * 100);
  } catch (err) {
    console.error("[sonarr] getSonarrDownloadProgress failed:", err);
    return null;
  }
}

/** Every episode currently in Sonarr's active download queue, with live progress. */
export async function getSonarrActiveDownloads(): Promise<ActiveDownload[]> {
  if (!isSonarrConfigured()) return [];
  try {
    const queue = await sonarrFetch<{
      records: {
        id: number;
        seriesId: number;
        episodeId?: number;
        title: string;
        size: number;
        sizeleft: number;
        added?: string;
        protocol?: string;
        trackedDownloadState?: string;
        statusMessages?: { messages?: string[] }[];
      }[];
    }>(`/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`);
    return queue.records.map((r) => {
      const unsafe = classifyBadRelease(r);
      return {
        queueId: r.id,
        startedAt: r.added ?? null,
        externalId: r.seriesId,
        episodeId: r.episodeId,
        title: r.title,
        progress: computeProgress(r.size, r.sizeleft),
        protocol: normalizeProtocol(r.protocol),
        sizeBytes: r.size > 0 ? r.size : null,
        importing: !unsafe && IMPORTING_STATES.has(r.trackedDownloadState ?? ""),
        ...(unsafe ? { unsafe } : {}),
      };
    });
  } catch (err) {
    console.error("[sonarr] getSonarrActiveDownloads failed:", err);
    return [];
  }
}

export type CompletedEpisode = {
  /** Sonarr's episode id -- what a per-episode delete targets. */
  episodeId: number;
  seriesId: number;
  title: string;
  protocol?: DownloadProtocol;
  sizeBytes: number | null;
  /** When the file landed in the library, for "recently added" ordering. */
  addedAt: string | null;
};

/** See getRadarrCompletedProtocols for the rationale -- same recovery, keyed
 *  by episode rather than series, since a show's episodes can each have come
 *  from either protocol. */
/**
 * Cached, because the downloads panel auto-refreshes every 2.5 seconds and
 * this is a 1000-record history query that measured 3.1s against the real
 * instance. Uncached, every render started a query that outlived the
 * interval that triggered it, so the requests overlapped permanently and
 * the panel's spinner had no quiet moment to stop in.
 *
 * 30s rather than something tighter: this only maps an episode to the
 * protocol it arrived over, which never changes once the grab happened.
 * The worst staleness is a just-downloaded episode showing no protocol
 * badge for a few seconds.
 */
const PROTOCOL_CACHE_TTL_MS = 30_000;
let protocolCache: { at: number; value: Map<number, DownloadProtocol> } | null = null;

export async function getSonarrCompletedProtocols(): Promise<Map<number, DownloadProtocol>> {
  if (protocolCache && Date.now() - protocolCache.at < PROTOCOL_CACHE_TTL_MS) {
    return protocolCache.value;
  }
  const result = new Map<number, DownloadProtocol>();
  if (!isSonarrConfigured()) return result;
  try {
    const history = await sonarrFetch<{
      records: { episodeId?: number; date: string; data?: { protocol?: string } }[];
    }>("/api/v3/history?pageSize=1000&eventType=1&sortKey=date&sortDirection=descending");
    for (const r of history.records) {
      if (r.episodeId == null || result.has(r.episodeId)) continue;
      result.set(r.episodeId, normalizeProtocol(r.data?.protocol));
    }
  } catch (err) {
    console.error("[sonarr] getSonarrCompletedProtocols failed:", err);
    // Not cached on failure: a transient error should not blank the
    // protocol badges for the next 30 seconds.
    return result;
  }
  protocolCache = { at: Date.now(), value: result };
  return result;
}

/**
 * Every downloaded episode, listed individually.
 *
 * Deliberately per-episode rather than per-series: movies appear one row per
 * film, so collapsing a whole show into a single "Severance" row made TV look
 * like it was missing from the panel, and left no way to delete one episode
 * without taking the entire series with it.
 */
/**
 * How long the completed-episodes list is reused.
 *
 * Building it costs the series list plus two calls per series with files --
 * about forty requests with the current library -- and the downloads panel
 * re-rendered it every 2.5 seconds while open. That was roughly sixteen
 * requests a second at Sonarr for as long as the tab stayed up, on top of its
 * own search load, and it is the likeliest reason Sonarr's web server kept
 * saturating. Files on disk change on the scale of minutes; thirty seconds of
 * staleness costs a finished episode half a minute of appearing late.
 */
const COMPLETED_EPISODES_TTL_MS = 30_000;

export async function getSonarrCompletedEpisodes(): Promise<CompletedEpisode[]> {
  if (!isSonarrConfigured()) return [];
  // Single-flight too: two open tabs share one fetch instead of doubling it.
  return cached("sonarr:completed-episodes", COMPLETED_EPISODES_TTL_MS, fetchCompletedEpisodes, {
    // An empty answer is usually a failed read, and caching it would blank
    // the list for the whole TTL.
    skipCacheIf: (rows) => rows.length === 0,
  });
}

// A file's protocol never changes, so a series' answer is kept for an hour.
const SERIES_PROTOCOL_TTL_MS = 60 * 60_000;

async function seriesProtocols(seriesId: number): Promise<Map<number, DownloadProtocol>> {
  try {
    return await cached(
      `sonarr:series-protocols:${seriesId}`,
      SERIES_PROTOCOL_TTL_MS,
      async () =>
        protocolsFromHistory(
          await sonarrFetch<HistoryEvent[]>(`/api/v3/history/series?seriesId=${seriesId}`),
          (e) => e.episodeId
        )
    );
  } catch (err) {
    console.error(`[sonarr] series history read failed for ${seriesId}:`, err);
    return new Map();
  }
}

async function fetchCompletedEpisodes(): Promise<CompletedEpisode[]> {
  try {
    const [series, protocols] = await Promise.all([
      sonarrFetch<{ id: number; title: string; statistics?: { episodeFileCount?: number } }[]>(
        "/api/v3/series"
      ),
      getSonarrCompletedProtocols(),
    ]);

    const withFiles = series.filter((s) => (s.statistics?.episodeFileCount ?? 0) > 0);
    const perSeries = await Promise.all(
      withFiles.map(async (s) => {
        const [episodes, files] = await Promise.all([
          sonarrFetch<
            { id: number; episodeFileId: number; seasonNumber: number; episodeNumber: number; title: string; hasFile: boolean }[]
          >(`/api/v3/episode?seriesId=${s.id}`),
          // The episode list only has episodeFileId, not the file itself --
          // this is what the movie side gets straight from movieFile. Same
          // fix as there: show the actual file name, not a synthesised
          // "show · SxxEyy · title" label that isn't what's really on disk.
          sonarrFetch<
            { id: number; relativePath: string; size?: number; dateAdded?: string }[]
          >(`/api/v3/episodefile?seriesId=${s.id}`),
        ]);
        // Episodes older than the global 1000-grab window get their protocol
        // from this series' own history -- see historyProtocolRules.
        const missing = episodes.some((e) => e.hasFile && !protocols.has(e.id));
        const ownHistory = missing ? await seriesProtocols(s.id) : new Map<number, DownloadProtocol>();
        const pathById = new Map(files.map((f) => [f.id, f.relativePath]));
        const sizeById = new Map(files.map((f) => [f.id, f.size ?? null]));
        const addedById = new Map(files.map((f) => [f.id, f.dateAdded ?? null]));
        return episodes
          .filter((e) => e.hasFile)
          .map((e) => {
            const relativePath = pathById.get(e.episodeFileId);
            return {
              episodeId: e.id,
              seriesId: s.id,
              title: relativePath
                ? fileBaseName(relativePath)
                : `${s.title} · S${e.seasonNumber} E${e.episodeNumber}${e.title ? ` · ${e.title}` : ""}`,
              protocol: protocols.get(e.id) ?? ownHistory.get(e.id),
              sizeBytes: sizeById.get(e.episodeFileId) ?? null,
              addedAt: addedById.get(e.episodeFileId) ?? null,
            };
          });
      })
    );
    return perSeries.flat();
  } catch (err) {
    console.error("[sonarr] getSonarrCompletedEpisodes failed:", err);
    return [];
  }
}

/** Deletes one episode's file (and the torrent still seeding it), leaving the series intact. */
export async function deleteSonarrEpisode(episodeId: number): Promise<boolean> {
  if (!isSonarrConfigured()) return false;
  try {
    // Grab the hash before deleting -- the history trail goes with the file.
    const downloadIds = await getSonarrDownloadIds([episodeId]);

    const episode = await sonarrFetch<{ episodeFileId?: number }>(`/api/v3/episode/${episodeId}`);
    if (episode.episodeFileId) {
      await sonarrFetch(`/api/v3/episodefile/${episode.episodeFileId}`, { method: "DELETE" });
    }
    await sonarrFetch(`/api/v3/episode/monitor`, {
      method: "PUT",
      body: JSON.stringify({ episodeIds: [episodeId], monitored: false }),
    });
    if (downloadIds.length > 0) await deleteTorrents(downloadIds);
    return true;
  } catch (err) {
    console.error(`[sonarr] deleteSonarrEpisode failed for ${episodeId}:`, err);
    return false;
  }
}

/**
 * Cancels every download for a series.
 *
 * `keepWanted` is for the healer, which replaces a bad download and wants the
 * episodes searched again. Without it this is a *person's* cancel, and that
 * has to be final: the show stops being wanted (episodes and seasons
 * unmonitored, queued searches dropped), searches already running are
 * stopped -- they would grab for unmonitored episodes too -- and only then is
 * the queue emptied, with a second sweep for anything grabbed in between.
 * Emptying the queue alone left Beetlejuice downloading all 107 episodes.
 *
 * Never blocklists on a person's cancel: cancelling says "I don't want this",
 * not "this release is bad", and a blocklist entry would follow the title into
 * any later, deliberate request.
 */
export async function cancelSonarrDownload(
  sonarrId: number,
  { blocklist = false, keepWanted = false }: { blocklist?: boolean; keepWanted?: boolean } = {}
): Promise<boolean> {
  if (!isSonarrConfigured()) return false;
  const emptyQueue = async (): Promise<number> => {
    const queue = await sonarrFetch<{ records: { id: number; seriesId: number }[] }>(
      `/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`
    );
    // A series can legitimately have several episodes in flight at once.
    const entries = queue.records.filter((r) => r.seriesId === sonarrId);
    for (const entry of entries) {
      await sonarrFetch(`/api/v3/queue/${entry.id}?removeFromClient=true&blocklist=${blocklist}`, {
        method: "DELETE",
      });
    }
    return entries.length;
  };
  try {
    if (!keepWanted) await stopWantingSeries(sonarrId);
    await emptyQueue();
    if (!keepWanted) {
      // A grab that was already in flight lands a moment after the first pass.
      await new Promise((resolve) => setTimeout(resolve, CANCEL_SWEEP_DELAY_MS));
      await emptyQueue();
    }
    // Idempotent: nothing queued means it already isn't downloading, which is
    // what a cancel is asking for -- reporting failure there produced a bogus
    // "couldn't cancel" for downloads that had just finished.
    return true;
  } catch (err) {
    console.error(`[sonarr] cancelSonarrDownload failed for ${sonarrId}:`, err);
    return false;
  }
}

/** Cancels live search commands that would grab for these episodes. Never throws. */
async function stopEpisodeSearches(
  episodeIds: number[],
  wholeSeason: { seriesId: number; seasonNumber: number } | null
): Promise<void> {
  try {
    const commands = await sonarrFetch<ArrCommand[]>("/api/v3/command");
    for (const id of episodeSearchesToCancel(commands, episodeIds, wholeSeason)) {
      await sonarrFetch(`/api/v3/command/${id}`, { method: "DELETE" }).catch(() => undefined);
    }
  } catch (err) {
    console.error("[sonarr] could not stop running episode searches:", err);
  }
}

/** How long after a cancel to look for a grab that was already under way. */
const CANCEL_SWEEP_DELAY_MS = 4_000;

/**
 * Makes Sonarr stop wanting a series without touching what is already on
 * disk: every episode and season unmonitored, Streamy's own queued searches
 * for it dropped, and live search commands for it cancelled. Each step is
 * best-effort -- a failure in one must not skip the rest.
 */
async function stopWantingSeries(sonarrId: number): Promise<void> {
  let episodeIds: number[] = [];
  try {
    const episodes = await sonarrFetch<SonarrEpisode[]>(`/api/v3/episode?seriesId=${sonarrId}`);
    episodeIds = episodes.map((e) => e.id);
    const monitored = episodes.filter((e) => e.monitored).map((e) => e.id);
    if (monitored.length > 0) {
      await sonarrFetch(`/api/v3/episode/monitor`, {
        method: "PUT",
        body: JSON.stringify({ episodeIds: monitored, monitored: false }),
      });
    }
  } catch (err) {
    console.error(`[sonarr] could not unmonitor episodes of series ${sonarrId}:`, err);
  }
  try {
    // Seasons too, or a metadata refresh re-monitors newly listed episodes.
    const series = await sonarrFetch<{ seasons?: { seasonNumber: number; monitored: boolean }[] } & Record<string, unknown>>(
      `/api/v3/series/${sonarrId}`
    );
    if ((series.seasons ?? []).some((s) => s.monitored)) {
      await sonarrFetch(`/api/v3/series/${sonarrId}`, {
        method: "PUT",
        body: JSON.stringify({ ...series, seasons: (series.seasons ?? []).map((s) => ({ ...s, monitored: false })) }),
      });
    }
  } catch (err) {
    console.error(`[sonarr] could not unmonitor seasons of series ${sonarrId}:`, err);
  }
  try {
    await (await searchQueue()).clearPendingSearches(episodeIds);
  } catch (err) {
    console.error(`[sonarr] could not clear pending searches for series ${sonarrId}:`, err);
  }
  try {
    const commands = await sonarrFetch<ArrCommand[]>("/api/v3/command");
    for (const id of seriesSearchesToCancel(commands, sonarrId, episodeIds)) {
      await sonarrFetch(`/api/v3/command/${id}`, { method: "DELETE" }).catch(() => undefined);
    }
  } catch (err) {
    console.error(`[sonarr] could not stop running searches for series ${sonarrId}:`, err);
  }
}

/** Kicks off a fresh release search for a series already in Sonarr. */
export async function searchSonarrSeries(sonarrId: number): Promise<void> {
  if (!isSonarrConfigured()) return;
  await sonarrFetch(`/api/v3/command`, {
    method: "POST",
    body: JSON.stringify({ name: "SeriesSearch", seriesId: sonarrId }),
  });
}

const COMMAND_POLL_MS = 2000;
/**
 * How long to wait for one search command to finish.
 *
 * Was 90s, which was shorter than a search actually takes once Sonarr has a
 * backlog -- observed 2026-09-26 with an EpisodeSearch that waited 30 minutes
 * between being queued and being started. The drain gave up waiting, issued the
 * next search, and did it again: every timeout added another command to a queue
 * that was already too long, and RssSync and ImportListSync starved behind
 * them. Five minutes is well past a healthy search (~20s) without feeding that
 * loop.
 */
const COMMAND_TIMEOUT_MS = 300_000;

/**
 * Searches Sonarr may have outstanding before this stops adding more.
 *
 * One, because Sonarr runs them more or less serially anyway: queueing a second
 * does not make it faster, it just makes the queue longer and pushes the
 * housekeeping commands further back.
 */
/**
 * How many episodes are searched individually before the rest is batched.
 *
 * Two: enough that something is playable as soon as possible and the next one
 * is ready behind it, few enough that the expensive per-episode search is
 * paid twice rather than thirteen times.
 */
// Zero since 2026-09-28: order no longer matters ("we don't need to download
// in order of episode number as long as we can speed up search/download
// time"), and one SeasonSearch covers a whole 8-episode season in ~40 s where
// searching the lead episodes first just delayed it. Kept as a constant so the
// behaviour is one number away if first-episode-first is ever wanted back.
const LEAD_EPISODES = 0;

/**
 * Searches allowed in flight at once.
 *
 * Was 1, which made a season strictly serial: every episode waited for a real
 * indexer search (~20s against Prowlarr) before the next one was even issued,
 * so a 55-episode backlog was about twenty minutes of "Searching..." no matter
 * how healthy everything was.
 *
 * Three keeps the ordering that matters -- searches are still *issued* in
 * episode order, so the early episodes are always the ones grabbed first and a
 * show still becomes watchable from the beginning -- while cutting the wall
 * time by roughly the same factor. It stays small on purpose: the reason this
 * limit exists at all is that filling Sonarr's command queue starves RssSync,
 * which is what left a freshly requested show reporting "no release found" for
 * half an hour.
 */
const MAX_OUTSTANDING_SEARCHES = 3;

/** Due rows checked per drain round before planning searches from them. */
const DRAIN_BATCH_ROWS = 40;

/** How long to wait before looking at the command queue again. */
const BACKLOG_POLL_MS = 15_000;

/**
 * Consecutive backlog waits before the drain gives up this pass.
 *
 * Without a bound, a search command that never finishes would hold the drain
 * in its poll loop forever -- and because only one drain runs at a time, that
 * would wedge every queued season behind it with no way back. Giving up is
 * cheap: the queue is persisted, and the next page load starts a fresh drain.
 */
const MAX_BACKLOG_WAITS = 20;

/**
 * EpisodeSearch commands Sonarr has not finished yet.
 *
 * Returns null when the queue cannot be read, which the caller treats as "do
 * not add work" -- an unreadable command queue is exactly when Sonarr is
 * struggling, and guessing zero is how the backlog got built in the first
 * place.
 */
export async function outstandingSearches(): Promise<number | null> {
  try {
    const commands = await sonarrFetch<SonarrCommand[]>("/api/v3/command");
    // A command that has been running too long is wedged, not busy, and is
    // not counted -- see countBlockingSearches for why that distinction is
    // what unblocked the ordered queue.
    return countBlockingSearches(commands);
  } catch {
    return null;
  }
}

/**
 * Waits for a Sonarr command to finish.
 *
 * Sonarr's search commands are asynchronous -- POSTing one returns as soon
 * as it's queued, not when the release has been grabbed. Firing a season's
 * searches back to back therefore says nothing about the order the grabs
 * land in. Waiting for each one is what actually makes the sequence
 * deterministic. Gives up after a timeout so one unfindable episode can't
 * wedge the rest of the season behind it.
 */
/**
 * Waits for a Sonarr command to finish. True if it did, false if the deadline
 * passed with it still queued or running.
 *
 * The distinction matters to the caller. This used to return nothing either
 * way, and the drain then deleted the episode's queue row as if the search had
 * happened -- so a search stuck in a backed-up Sonarr simply vanished from the
 * admin panel, and the episode read as never requested.
 */
async function waitForSonarrCommand(commandId: number): Promise<boolean> {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const cmd = await sonarrFetch<{ status: string }>(`/api/v3/command/${commandId}`);
      if (cmd.status === "completed" || cmd.status === "failed" || cmd.status === "aborted") {
        return true;
      }
    } catch {
      return true; // treat an unreadable command as done rather than stalling the chain
    }
    await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_MS));
  }
  return false;
}

/**
 * Episodes Sonarr still wants but has nothing in flight for: monitored, no
 * file, aired, and absent from the queue. Same failure shape as the Radarr
 * side -- a search that found nothing leaves the episode sitting in
 * "searching" forever with no search actually running.
 */
export async function getIdleWantedEpisodes(): Promise<
  { episodeId: number; title: string; seriesId: number; seasonNumber: number }[]
> {
  if (!isSonarrConfigured()) return [];
  try {
    const [wanted, queue] = await Promise.all([
      sonarrFetch<{
        records: { id: number; title: string; seriesId: number; seasonNumber: number; monitored: boolean }[];
      }>(`/api/v3/wanted/missing?pageSize=50&sortKey=airDateUtc&sortDirection=descending`),
      sonarrFetch<{ records: { episodeId?: number }[] }>(`/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`),
    ]);
    const queued = new Set(
      queue.records.map((r) => r.episodeId).filter((id): id is number => id != null)
    );
    return wanted.records
      // Season 0 is left out: specials are bonus clips and behind-the-scenes
      // featurettes that indexers almost never carry, so re-searching them
      // only ever came up empty -- 27 of them at a time, on every pass,
      // ahead of real requests. A special someone explicitly asks for still
      // goes through the ordered queue, which retries it on its own.
      .filter((e) => e.monitored && e.seasonNumber !== 0 && !queued.has(e.id))
      .map((e) => ({ episodeId: e.id, title: e.title, seriesId: e.seriesId, seasonNumber: e.seasonNumber }));
  } catch (err) {
    console.error("[sonarr] getIdleWantedEpisodes failed:", err);
    return [];
  }
}

/**
 * Torrent infohashes Sonarr grabbed for these episodes.
 *
 * Sonarr forgets a torrent once it's imported, so this is the only way back
 * to the thing still seeding in the download client after a delete.
 */
export async function getSonarrDownloadIds(episodeIds: number[]): Promise<string[]> {
  if (!isSonarrConfigured() || episodeIds.length === 0) return [];
  const hashes = new Set<string>();
  for (const episodeId of episodeIds) {
    try {
      const history = await sonarrFetch<{
        records: { eventType?: string; downloadId?: string }[];
      }>(`/api/v3/history?pageSize=50&episodeId=${episodeId}`);
      for (const r of history.records) {
        // Only releases that actually landed -- ignore failed grabs, whose
        // torrents were already cleaned up.
        if (r.downloadId && (r.eventType === "downloadFolderImported" || r.eventType === "grabbed")) {
          hashes.add(r.downloadId);
        }
      }
    } catch (err) {
      console.error(`[sonarr] getSonarrDownloadIds failed for episode ${episodeId}:`, err);
    }
  }
  return Array.from(hashes);
}

/** Sonarr twin of expireRadarrBlocklist -- see that function for why this exists. */
export async function expireSonarrBlocklist(
  maxAgeHours: number,
  keep?: (record: BlocklistRecord) => boolean,
  releaseNow?: (record: BlocklistRecord) => boolean
): Promise<number> {
  if (!isSonarrConfigured()) return 0;
  return expireBlocklist(sonarrFetch, maxAgeHours, "sonarr", keep, releaseNow);
}

/** Cancels one specific queued download, leaving the series' other episodes alone. */
export async function cancelSonarrQueueItem(
  queueId: number,
  {
    blocklist = false,
    // True for the healer replacing a bad or stalled download: the episode is
    // still wanted, and a replacement search follows. Everything below this
    // flag is what makes a *person's* cancel final -- applied to the healer it
    // unmonitored every episode it re-grabbed, so the idle pass (monitored
    // only) stopped seeing it, upgrades stopped, and a re-grab that failed
    // left the episode stranded for good.
    keepWanted = false,
  }: { blocklist?: boolean; keepWanted?: boolean } = {}
): Promise<boolean> {
  if (!isSonarrConfigured()) return false;
  try {
    // Which episode this entry belongs to, read before the delete because
    // afterwards there is nothing left to ask. Cancelling has to stop the
    // episode being wanted, not just stop this one transfer -- see below.
    let episodeId: number | null = null;
    try {
      const queue = await sonarrFetch<{
        records: { id: number; episodeId?: number }[];
      }>(`/api/v3/queue?pageSize=250`);
      episodeId = queue.records.find((r) => r.id === queueId)?.episodeId ?? null;
    } catch (err) {
      console.error(`[sonarr] could not resolve the episode for queue ${queueId}:`, err);
    }

    await sonarrFetch(`/api/v3/queue/${queueId}?removeFromClient=true&blocklist=${blocklist}`, {
      method: "DELETE",
    });

    // A cancel that only removes the queue entry is not a cancel.
    //
    // The episode stays monitored and stays in the ordered search queue, so
    // the next drain searches it again and it downloads again -- reported as
    // cancelled titles "popping back up". Worse, each cancel blocklists the
    // release it removed, so every round burns another candidate until the
    // season reports "no releases found" for titles that had plenty.
    //
    // The episode-level path (manageSonarrEpisodes) always did both of these;
    // this one, which is what the admin downloads panel calls, did neither.
    if (episodeId != null && !keepWanted) {
      try {
        await sonarrFetch(`/api/v3/episode/monitor`, {
          method: "PUT",
          body: JSON.stringify({ episodeIds: [episodeId], monitored: false }),
        });
      } catch (err) {
        console.error(`[sonarr] could not unmonitor episode ${episodeId}:`, err);
      }
      try {
        await (await searchQueue()).clearPendingSearches([episodeId]);
      } catch (err) {
        console.error(`[sonarr] could not clear the pending search for ${episodeId}:`, err);
      }
      await stopEpisodeSearches([episodeId], null);
    }
    return true;
  } catch (err) {
    console.error(`[sonarr] cancelSonarrQueueItem failed for ${queueId}:`, err);
    return false;
  }
}

export type QueuedEpisodeSearch = {
  episodeId: number;
  seriesId: number;
  /** When it was asked for, so the newest request sorts to the top. */
  enqueuedAt: string | null;
  /** Covered by a SeasonSearch right now rather than waiting its turn. */
  batched: boolean;
  /** "The Sopranos - S2 E3 - Title", ready to show. */
  title: string;
  attempts: number;
};

/**
 * Everything waiting in the ordered search queue, labelled for display.
 *
 * The downloads panel used to show only what Radarr/Sonarr had already
 * queued plus the handful of MediaRequest rows still searching. A season
 * request is a *single* MediaRequest, so asking for five seasons put one row
 * on screen while sixty episodes sat here invisibly -- which reads as "I
 * asked for far more than this" and gives no way to see that the rest are
 * fine, just waiting their turn.
 *
 * Titles come from the series and episode lists rather than being synthesised
 * from ids, so a queued row says the same thing the show page does.
 */
/**
 * Names every episode of a series and stores the names on its queue rows.
 *
 * Called right after a request is enqueued -- when Sonarr has just answered,
 * so it is the one moment a lookup is sure to work -- and again from the
 * panel for any row still unnamed. Never throws: a row without a name is
 * still a row.
 */
async function storeSeriesLabels(seriesId: number): Promise<Map<number, string>> {
  const labels = new Map<number, string>();
  try {
    const [series, eps] = await Promise.all([
      sonarrFetch<{ title: string }>(`/api/v3/series/${seriesId}`),
      sonarrFetch<{ id: number; seasonNumber: number; episodeNumber: number; title: string }[]>(
        `/api/v3/episode?seriesId=${seriesId}`
      ),
    ]);
    for (const e of eps) {
      labels.set(
        e.id,
        `${series.title} - S${e.seasonNumber} E${e.episodeNumber}${e.title ? ` - ${e.title}` : ""}`
      );
    }
    await (await searchQueue()).setPendingLabels(labels);
  } catch (err) {
    console.error(`[sonarr] could not label queued episodes for series ${seriesId}:`, err);
  }
  return labels;
}

/**
 * Labels already resolved, kept for the life of the process.
 *
 * The rows come from Streamy's own database and are always available; the
 * names come from Sonarr and are not. When Sonarr is busy searching -- which
 * is exactly when someone opens this panel -- the lookup fails and every row
 * used to fall back to "Episode 1533", which is unreadable and looks broken.
 *
 * A name does not change, so one successful lookup is enough forever. This
 * turns a Sonarr hiccup into "the newest few rows are unnamed" instead of
 * "every row is a number".
 */
const episodeLabels = new Map<number, string>();

/** How long labelling may take before the rows are returned unlabelled. */
const LABEL_DEADLINE_MS = 4000;

export async function getQueuedEpisodeSearches(): Promise<QueuedEpisodeSearch[]> {
  if (!isSonarrConfigured()) return [];
  let pending: {
    episodeId: number;
    seriesId: number;
    attempts: number;
    enqueuedAt?: Date;
    searchAfter?: Date | null;
    label?: string | null;
  }[] = [];
  try {
    const { pendingSearchesForDisplay } = await import("./pendingEpisodeSearch");
    pending = await pendingSearchesForDisplay();
  } catch (err) {
    console.error("[sonarr] could not read the pending search queue:", err);
    return [];
  }
  if (pending.length === 0) return [];

  // Stored names first; only rows with neither a stored nor a cached name
  // need Sonarr, and those lookups also write the name back for next time.
  for (const p of pending) {
    if (p.label) episodeLabels.set(p.episodeId, p.label);
  }
  const unknown = pending.filter((p) => !episodeLabels.has(p.episodeId));
  const seriesIds = [...new Set(unknown.map((p) => p.seriesId))];

  if (seriesIds.length > 0) {
    // Bounded, and separately from the rows themselves: a row with no name is
    // still a row the viewer needs to see.
    const labelling = Promise.all(
      seriesIds.map(async (seriesId) => {
        const labels = await storeSeriesLabels(seriesId);
        for (const [id, label] of labels) episodeLabels.set(id, label);
      })
    );
    await Promise.race([
      labelling,
      new Promise((resolve) => setTimeout(resolve, LABEL_DEADLINE_MS)),
    ]);
  }

  return pending.map((p) => ({
    episodeId: p.episodeId,
    seriesId: p.seriesId,
    enqueuedAt: p.enqueuedAt ? new Date(p.enqueuedAt).toISOString() : null,
    batched: p.searchAfter != null && new Date(p.searchAfter).getTime() > Date.now(),
    title: episodeLabels.get(p.episodeId) ?? `Episode ${p.episodeId}`,
    attempts: p.attempts,
  }));
}

/**
 * Cancels an episode that is queued for search but not yet searched.
 *
 * Final, by design. Removing the queue row alone would leave the episode
 * monitored, and the healer re-searches anything monitored with no file --
 * so it would come back on its own within the hour without anyone asking.
 * Unmonitoring is what makes a cancel stay cancelled; requesting the episode
 * again re-monitors it, which is the only way it should return.
 */
export async function dropQueuedEpisodeSearch(episodeId: number): Promise<boolean> {
  if (!isSonarrConfigured()) return false;
  try {
    await (await searchQueue()).clearPendingSearches([episodeId]);
  } catch (err) {
    console.error(`[sonarr] could not clear the pending search for ${episodeId}:`, err);
    return false;
  }
  try {
    await sonarrFetch(`/api/v3/episode/monitor`, {
      method: "PUT",
      body: JSON.stringify({ episodeIds: [episodeId], monitored: false }),
    });
  } catch (err) {
    // The row is gone, which is most of the job; report the failure rather
    // than claiming a clean cancel that the healer may undo.
    console.error(`[sonarr] could not unmonitor episode ${episodeId}:`, err);
    return false;
  }
  return true;
}

/**
 * Episode ids Sonarr is already downloading.
 *
 * Used by the drain to skip work that is in flight. Returns an empty set on
 * failure rather than throwing: not knowing means searching an episode a
 * second time, which is wasteful, while treating the whole pass as failed
 * would stop the queue moving at all.
 */
async function episodesInQueue(): Promise<Set<number>> {
  try {
    const queue = await sonarrFetch<{ records: { episodeId?: number }[] }>(
      `/api/v3/queue?pageSize=250`
    );
    return new Set(
      queue.records.map((r) => r.episodeId).filter((id): id is number => typeof id === "number")
    );
  } catch (err) {
    console.error("[sonarr] could not read the queue to skip in-flight episodes:", err);
    return new Set();
  }
}

/** Kicks off a search for specific episodes. */
export async function searchSonarrEpisodes(episodeIds: number[]): Promise<void> {
  if (!isSonarrConfigured() || episodeIds.length === 0) return;
  await sonarrFetch(`/api/v3/command`, {
    method: "POST",
    body: JSON.stringify({ name: "EpisodeSearch", episodeIds }),
  });
}

/** Health snapshot of every entry in Sonarr's queue, for the stall auto-healer. */
export async function getSonarrQueueHealth(): Promise<QueueHealth[]> {
  if (!isSonarrConfigured()) return [];
  try {
    const queue = await sonarrFetch<{
      records: {
        id: number;
        seriesId: number;
        episodeId?: number;
        title: string;
        size: number;
        sizeleft: number;
        added?: string;
        errorMessage?: string;
        status?: string;
        downloadId?: string;
        statusMessages?: { messages?: string[] }[];
        trackedDownloadState?: string;
        trackedDownloadStatus?: string;
        protocol?: string;
        episodeHasFile?: boolean;
      }[];
    }>(`/api/v3/queue?pageSize=250`);
    return queue.records.map((r) => toQueueHealth({ ...r, hasFile: r.episodeHasFile }, r.seriesId));
  } catch (err) {
    console.error("[sonarr] getSonarrQueueHealth failed:", err);
    return [];
  }
}

/** Removes a series (and its downloaded episode files, if any) from Sonarr entirely. */
export async function deleteSonarrSeries(sonarrId: number): Promise<boolean> {
  if (!isSonarrConfigured()) return false;
  try {
    // Gather torrent hashes before the delete wipes the history trail.
    const episodes = await sonarrFetch<SonarrEpisode[]>(`/api/v3/episode?seriesId=${sonarrId}`);
    const downloadIds = await getSonarrDownloadIds(episodes.map((e) => e.id));

    await sonarrFetch(`/api/v3/series/${sonarrId}?deleteFiles=true&addImportExclusion=false`, {
      method: "DELETE",
    });
    if (downloadIds.length > 0) await deleteTorrents(downloadIds);
    return true;
  } catch (err) {
    console.error(`[sonarr] deleteSonarrSeries failed for ${sonarrId}:`, err);
    return false;
  }
}

export type SonarrEpisode = {
  id: number;
  episodeNumber: number;
  seasonNumber: number;
  hasFile: boolean;
  monitored: boolean;
  lastSearchTime?: string | null;
};

/**
 * Finds the series in Sonarr, adding it first if it isn't there yet.
 *
 * When adding for a season/episode request the series is created with
 * nothing monitored and no search kicked off -- otherwise Sonarr would
 * immediately start grabbing the entire show, which is the opposite of
 * asking for one episode. The caller then monitors and searches exactly
 * what was requested.
 */
async function ensureSeriesInSonarr(
  tmdbId: string,
  tier: QualityTier = "hd"
): Promise<
  { ok: true; sonarrId: number; created: boolean } | { ok: false; error: string }
> {
  const { tvdbId } = await getTvExternalIds(tmdbId);
  if (!tvdbId) return { ok: false, error: "No TVDB id found for this show on TMDB" };

  const existing = await sonarrFetch<{ id: number }[]>(`/api/v3/series?tvdbId=${tvdbId}`);
  if (existing[0]) return { ok: true, sonarrId: existing[0].id, created: false };

  const lookup = await sonarrFetch<Record<string, unknown>[]>(
    `/api/v3/series/lookup?term=tvdb:${tvdbId}`
  );
  const match = lookup[0];
  if (!match) return { ok: false, error: "Show not found via Sonarr lookup" };

  const seasons = Array.isArray(match.seasons)
    ? (match.seasons as { seasonNumber: number }[]).map((s) => ({
        seasonNumber: s.seasonNumber,
        monitored: false,
      }))
    : [];

  const created = await sonarrFetch<{ id: number }>(`/api/v3/series`, {
    method: "POST",
    body: JSON.stringify({
      ...match,
      tvdbId,
      qualityProfileId: resolveQualityProfileId(
        tier,
        SONARR_QUALITY_PROFILE_ID,
        SONARR_QUALITY_PROFILE_ID_4K
      ),
      rootFolderPath: SONARR_ROOT_FOLDER,
      monitored: true,
      addOptions: { searchForMissingEpisodes: false },
      seasons,
    }),
  });
  return { ok: true, sonarrId: created.id, created: true };
}

/**
 * How long to wait for a freshly added series to have episodes.
 *
 * Adding a series returns as soon as the row exists. Sonarr then fetches the
 * episode list from its metadata provider in the background, so a read issued
 * immediately after the add comes back empty -- which does not mean "this
 * season has no episodes", it means "ask again in a moment".
 *
 * Reading it as the former is what produced the report of a download button
 * that says Retry the instant it is pressed and then works when pressed
 * again: the first click raced the metadata fetch and got an empty list, and
 * by the time the second arrived the episodes were there.
 */
const EPISODE_POPULATE_TIMEOUT_MS = 20_000;
const EPISODE_POPULATE_POLL_MS = 400;

/**
 * A season's episodes, waiting for Sonarr to populate them if it is still
 * fetching metadata for a series that was just added.
 *
 * Only waits when the series is new. An established series with no episodes
 * in a season genuinely has none -- an unaired season, or specials -- and
 * polling for twenty seconds before saying so would turn a fast, correct
 * answer into a slow one.
 */
async function episodesWhenReady(
  seriesId: number,
  seasonNumber: number,
  justCreated: boolean
): Promise<SonarrEpisode[]> {
  const deadline = Date.now() + EPISODE_POPULATE_TIMEOUT_MS;
  for (;;) {
    const episodes = await sonarrFetch<SonarrEpisode[]>(
      `/api/v3/episode?seriesId=${seriesId}&seasonNumber=${seasonNumber}`
    );
    if (episodes.length > 0 && justCreated) {
      // Episodes exist before Sonarr's post-add actions have run, and those
      // reset every episode's monitored flag -- see seriesRefreshPending. Hold
      // until the initial refresh has finished, so the monitoring the caller
      // applies next is the last word rather than being undone a moment later.
      await waitForSeriesRefresh(seriesId, deadline + SERIES_REFRESH_EXTRA_MS);
      return await sonarrFetch<SonarrEpisode[]>(
        `/api/v3/episode?seriesId=${seriesId}&seasonNumber=${seasonNumber}`
      );
    }
    if (episodes.length > 0 || !justCreated || Date.now() >= deadline) return episodes;
    await new Promise((resolve) => setTimeout(resolve, EPISODE_POPULATE_POLL_MS));
  }
}

// Extra time allowed for a new series' initial refresh beyond the wait for
// its episodes to appear: the disk scan and post-add actions come after.
const SERIES_REFRESH_EXTRA_MS = 20_000;

async function waitForSeriesRefresh(seriesId: number, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    let pending = false;
    try {
      const commands = await sonarrFetch<Parameters<typeof seriesRefreshPending>[0]>("/api/v3/command");
      pending = seriesRefreshPending(commands, seriesId);
    } catch {
      // Unreadable command list: carry on rather than block the request; the
      // worst case is the race this guards against, not a failure.
      return;
    }
    if (!pending) return;
    await new Promise((resolve) => setTimeout(resolve, EPISODE_POPULATE_POLL_MS));
  }
  console.warn(`[sonarr] series ${seriesId} still refreshing at the deadline; monitoring anyway`);
}

/** Every episode Sonarr knows about for one season. */
export async function getSonarrSeasonEpisodes(
  tmdbId: string,
  seasonNumber: number
): Promise<SonarrEpisode[]> {
  if (!isSonarrConfigured()) return [];
  try {
    const { tvdbId } = await getTvExternalIds(tmdbId);
    if (!tvdbId) return [];
    const series = await sonarrFetch<{ id: number }[]>(`/api/v3/series?tvdbId=${tvdbId}`);
    if (!series[0]) return [];
    return await sonarrFetch<SonarrEpisode[]>(
      `/api/v3/episode?seriesId=${series[0].id}&seasonNumber=${seasonNumber}`
    );
  } catch (err) {
    console.error(`[sonarr] getSonarrSeasonEpisodes failed for ${tmdbId} S${seasonNumber}:`, err);
    return [];
  }
}

/** The chronologically earliest downloaded episode of a show, if any. */
export async function getEarliestDownloadedEpisode(
  tmdbId: string
): Promise<{ seasonNumber: number; episodeNumber: number } | null> {
  if (!isSonarrConfigured()) return null;
  try {
    const { tvdbId } = await getTvExternalIds(tmdbId);
    if (!tvdbId) return null;
    const series = await sonarrFetch<{ id: number }[]>(`/api/v3/series?tvdbId=${tvdbId}`);
    if (!series[0]) return null;
    return earliestDownloaded(await sonarrFetch<SonarrEpisode[]>(`/api/v3/episode?seriesId=${series[0].id}`));
  } catch (err) {
    console.error(`[sonarr] getEarliestDownloadedEpisode failed for ${tmdbId}:`, err);
    return null;
  }
}

export type EpisodeState = {
  status: MediaRequestStatus;
  /** 0-100 while downloading; null when not started or metadata unresolved. */
  progress: number | null;
  /** Sonarr's id for the episode, so a caller can look up its history. */
  episodeId?: number;
  /** Releases that stalled or failed and were replaced in the last day. */
  tried?: number;
};
export type EpisodeStatusMap = Record<number, EpisodeState>;

/**
 * Per-episode status and live progress for one season, derived from Sonarr
 * rather than stored in Streamy -- Sonarr already knows what's on disk and
 * what's queued, and a per-episode table would just drift out of sync.
 */
export async function getSonarrSeasonStatuses(
  tmdbId: string,
  seasonNumber: number
): Promise<EpisodeStatusMap> {
  if (!isSonarrConfigured()) return {};
  try {
    const episodes = await getSonarrSeasonEpisodes(tmdbId, seasonNumber);
    if (episodes.length === 0) return {};

    const queue = await sonarrFetch<{
      records: { episodeId?: number; size: number; sizeleft: number }[];
    }>(`/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`);
    const queued = new Map<number, { size: number; sizeleft: number }>();
    for (const r of queue.records) {
      if (r.episodeId != null) queued.set(r.episodeId, { size: r.size, sizeleft: r.sizeleft });
    }

    const statuses: EpisodeStatusMap = {};
    for (const ep of episodes) {
      const q = queued.get(ep.id);
      if (ep.hasFile) {
        statuses[ep.episodeNumber] = { status: "available", progress: null, episodeId: ep.id };
      } else if (q) {
        statuses[ep.episodeNumber] = {
          status: "downloading",
          progress: q.size > 0 ? Math.round(((q.size - q.sizeleft) / q.size) * 100) : null,
          episodeId: ep.id,
        };
      } else if (ep.monitored) {
        // "requested" (still searching) vs "noReleaseFound" (searched, came
        // up empty) -- see isSearchStale for the rationale. Without this an
        // episode with nothing available looked identical to one about to
        // succeed any second. hasRecentlyTriggeredSearch covers the window
        // right after *we* asked Sonarr to search, before its own
        // lastSearchTime has actually updated to reflect that -- see its doc.
        statuses[ep.episodeNumber] = {
          status:
            isSearchStale(ep.lastSearchTime) && !hasRecentlyTriggeredSearch(ep.id)
              ? "noReleaseFound"
              : "requested",
          progress: null,
          episodeId: ep.id,
        };
      }
    }
    return statuses;
  } catch (err) {
    console.error(`[sonarr] getSonarrSeasonStatuses failed for ${tmdbId} S${seasonNumber}:`, err);
    return {};
  }
}

/** Monitors and searches a single episode. */
export async function requestEpisode(
  tmdbId: string,
  seasonNumber: number,
  episodeNumber: number,
  tier: QualityTier = "hd"
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSonarrConfigured()) return { ok: false, error: "Sonarr is not configured" };
  try {
    const series = await ensureSeriesInSonarr(tmdbId, tier);
    if (!series.ok) return series;

    const episodes = await episodesWhenReady(
      series.sonarrId,
      seasonNumber,
      series.created
    );
    const episode = episodes.find((e) => e.episodeNumber === episodeNumber);
    if (!episode) return { ok: false, error: "Episode not found in Sonarr" };

    await sonarrFetch(`/api/v3/episode/monitor`, {
      method: "PUT",
      body: JSON.stringify({ episodeIds: [episode.id], monitored: true }),
    });
    // Through the same queue a season uses, rather than firing a search
    // straight at Sonarr. Searching directly left nothing anywhere to say the
    // episode had been asked for, so the admin panel stayed empty until
    // Sonarr happened to grab something -- and if the search found nothing,
    // forever. Queuing it records the request first, and the drain this kicks
    // off searches it immediately anyway, so nothing gets slower.
    await searchEpisodesInOrder(series.sonarrId, [episode.id]);
    // Alongside the ordinary search, for a release Sonarr finds but cannot
    // place -- see deepSearchSonarrEpisode. Never awaited.
    void deepSearchSonarrEpisode(series.sonarrId, episode.id).catch((err) =>
      console.error(`[sonarr] episode deep search failed for ${tmdbId} S${seasonNumber}E${episodeNumber}:`, err)
    );
    return { ok: true };
  } catch (err) {
    console.error(`[sonarr] requestEpisode failed for ${tmdbId} S${seasonNumber}E${episodeNumber}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Sonarr error" };
  }
}

/**
 * The search queue's storage, loaded on demand rather than imported at the top
 * of this file.
 *
 * sonarr.ts is pulled in by unit tests that are pure by design -- CI installs
 * with --ignore-scripts, so the generated Prisma client does not exist there at
 * all. A static import would make the database a load-time dependency of every
 * one of those tests, which is what broke the build the first time this queue
 * landed. Deferring it keeps the queue's storage a runtime concern of the two
 * functions that actually touch it.
 */
function searchQueue() {
  return import("./pendingEpisodeSearch");
}

/**
 * Queues the given episodes to be searched one at a time, in the order
 * supplied, waiting for each grab to finish before starting the next so
 * downloads queue up in episode order.
 *
 * The queue is persisted rather than held in this process. A 64-episode
 * season takes the better part of an hour to work through, and when the chain
 * lived only in memory a deploy part-way through dropped everything left with
 * no trace -- episode 1 downloaded, the rest sat monitored and un-searched
 * forever, because Sonarr's RSS sync only picks up new releases and never
 * back-searches. Persisting it means the chain resumes on the next page load
 * instead.
 */
/**
 * How long a SeasonSearch gets before its episodes fall back to individual
 * searches. Measured: a 21-episode SeasonSearch took 144s on an idle Sonarr
 * and several minutes under load, so fifteen minutes is generous without
 * leaving a missed episode waiting long.
 */
const BATCH_GRACE_MS = 15 * 60_000;

/**
 * Records episodes a SeasonSearch/SeriesSearch is covering.
 *
 * Without this, only the individually searched lead episodes had rows, so a
 * season request showed two rows and the rest appeared only once grabbed --
 * reported for South Park as "newly queued downloads aren't showing up". They
 * are recorded now with a searchAfter in the future: visible immediately,
 * left alone by the drain while the batch works, and searched individually
 * afterwards only if the batch missed them.
 */
async function recordBatchedEpisodes(seriesId: number, episodeIds: number[]): Promise<void> {
  if (episodeIds.length === 0) return;
  for (const id of episodeIds) markEpisodeSearchTriggered(id);
  await (await searchQueue()).enqueueEpisodeSearches(
    seriesId,
    episodeIds,
    new Date(Date.now() + BATCH_GRACE_MS)
  );
  await storeSeriesLabels(seriesId);
}

/**
 * Records the request, then starts working on it.
 *
 * The await matters and is the whole point: the caller's HTTP response is
 * what the admin panel refreshes on, so an enqueue that is still in flight
 * when the response returns means the panel renders before the rows exist and
 * shows nothing. Reported as downloads not appearing until much later.
 *
 * The drain is deliberately not awaited -- a season takes minutes, and the
 * request should return as soon as the work is *recorded*, not once it is
 * done.
 */
async function searchEpisodesInOrder(seriesId: number, episodeIds: number[]): Promise<void> {
  // Marked for the whole batch up front, not just as each one's own turn
  // comes up below: this chain runs sequentially and can take minutes for a
  // full season, so an episode still waiting its turn -- monitored and
  // genuinely queued, just not searched yet -- would otherwise show
  // whatever its lastSearchTime said before this request (stale, for one
  // that had already failed once), i.e. "no releases found" for a season
  // that had, in reality, only just been asked for.
  for (const id of episodeIds) markEpisodeSearchTriggered(id);
  await (await searchQueue()).enqueueEpisodeSearches(seriesId, episodeIds);
  await storeSeriesLabels(seriesId);
  void drainEpisodeSearches();
}

/**
 * One drain at a time. The queue is a strict order, so a second worker would
 * either search out of order or search the same episode twice.
 *
 * In-process is enough: Streamy runs as a single Node server. If that ever
 * stops being true this needs a real claim on the row.
 */
let draining = false;

/** Works the persisted queue until it is empty. Never throws. */
async function drainEpisodeSearches(deadline: number | null = null): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    // The in-memory search marks do not survive the restart this queue exists
    // to tolerate, so re-assert them for everything still waiting -- without
    // this, a resumed season reads as "no releases found" until its turn.
    const queue = await searchQueue();
    for (const id of await queue.pendingSearchIds()) markEpisodeSearchTriggered(id);

    let backlogWaits = 0;

    for (;;) {
      // A pass is bounded, not exhaustive. A long season legitimately takes
      // longer than any single HTTP request should, and before the warden
      // there was no reliable next pass, so the drain ran until the queue was
      // empty -- which now means the caller times out mid-drain. Stopping on
      // a budget is safe precisely because the next pass is guaranteed.
      if (deadline != null && Date.now() >= deadline) {
        console.warn("[sonarr] search queue drain hit its time budget; resuming next pass");
        return;
      }

      // Do not pile onto a backlog. Checked before taking the next item so a
      // busy Sonarr simply delays the drain rather than filling its command
      // queue -- which is what starved RssSync and left a freshly requested
      // show reporting "no release found" for half an hour.
      const outstanding = await outstandingSearches();
      if (outstanding === null || outstanding >= MAX_OUTSTANDING_SEARCHES) {
        backlogWaits += 1;
        if (backlogWaits > MAX_BACKLOG_WAITS) {
          console.warn("[sonarr] search queue still busy; leaving the rest for the next pass");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, BACKLOG_POLL_MS));
        continue;
      }
      backlogWaits = 0;

      // Re-read each time round rather than once before the loop: a pass can
      // run for minutes, and episodes grabbed during it should stop being
      // searched as soon as that is true.
      const downloading = await episodesInQueue();

      const due = await queue.duePendingSearches();
      if (due.length === 0) return;

      // Validated at their turn rather than trusting the queue, which may have
      // been written an hour ago. An explicit search grabs regardless of
      // monitoring, so without this a cancelled episode would simply start
      // downloading again: unmonitored means cancelled. Already downloading
      // counts as done -- searching it again grabs a second copy.
      const candidates: SearchCandidate[] = [];
      for (const row of due.slice(0, DRAIN_BATCH_ROWS)) {
        try {
          const episode = await sonarrFetch<{ monitored: boolean; hasFile: boolean; seasonNumber: number }>(
            `/api/v3/episode/${row.episodeId}`
          );
          if (!episode.monitored || episode.hasFile || downloading.has(row.episodeId)) {
            await queue.completePendingSearch(row.episodeId);
            continue;
          }
          candidates.push({ episodeId: row.episodeId, seriesId: row.seriesId, seasonNumber: episode.seasonNumber });
        } catch (err) {
          console.error(`[sonarr] could not check queued episode ${row.episodeId}:`, err);
          await queue.failPendingSearch(row.episodeId);
        }
      }
      if (candidates.length === 0) continue;

      // Grouped and run side by side, not one episode at a time in request
      // order -- see planSearches. Order stopped mattering on 2026-09-28;
      // time to ready is what counts.
      const plan = planSearches(candidates, MAX_OUTSTANDING_SEARCHES - outstanding);
      const results = await Promise.all(
        plan.map(async (search) => {
          try {
            const cmd = await sonarrFetch<{ id: number }>(`/api/v3/command`, {
              method: "POST",
              body: JSON.stringify(
                search.kind === "season"
                  ? { name: "SeasonSearch", seriesId: search.seriesId, seasonNumber: search.seasonNumber }
                  : { name: "EpisodeSearch", episodeIds: search.episodeIds }
              ),
            });
            for (const id of search.episodeIds) markEpisodeSearchTriggered(id);
            return { search, finished: await waitForSonarrCommand(cmd.id), failed: false };
          } catch (err) {
            console.error(`[sonarr] ${search.kind} search failed for ${search.episodeIds.join(",")}:`, err);
            return { search, finished: false, failed: true };
          }
        })
      );

      let stillQueued = false;
      for (const { search, finished, failed } of results) {
        if (failed) {
          for (const id of search.episodeIds) await queue.failPendingSearch(id);
        } else if (finished) {
          for (const id of search.episodeIds) await queue.completePendingSearch(id);
        } else {
          // Still waiting in Sonarr's own queue: the search has not run, so
          // the rows stay.
          stillQueued = true;
        }
      }
      if (stillQueued) {
        // Sonarr is backed up, and issuing more is exactly how the backlog grew.
        console.warn("[sonarr] searches still queued in Sonarr; pausing the drain");
        return;
      }
      if (results.some((r) => r.failed)) {
        // The usual cause is Sonarr being briefly unreachable, which affects
        // whatever is at the head of the queue rather than these episodes in
        // particular -- so pause instead of burning their attempts at once.
        await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_MS));
      }
    }
  } catch (err) {
    // A database failure, i.e. the queue itself is unreadable. The next
    // caller retries.
    console.error("[sonarr] search queue drain failed:", err);
  } finally {
    draining = false;
  }
}

/**
 * Resumes the search queue if anything is waiting. Safe to call from hot
 * paths: it returns immediately while a drain is already running, and never
 * throws.
 *
 * This is what makes the queue self-healing after a restart -- the drain that
 * was interrupted picks up again the next time anyone loads a page.
 */
export function maybeDrainEpisodeSearches(): void {
  if (!isSonarrConfigured()) return;
  void drainEpisodeSearches();
}

/**
 * Drains the queue and waits for the pass to finish.
 *
 * The fire-and-forget version above is right for a page render, which must not
 * block on a season's worth of searching. It is not enough on its own: when
 * Sonarr is busy the drain gives up with "leaving the rest for the next pass",
 * and for a long time there was no next pass unless somebody happened to load
 * the admin downloads page. That is how a queued season sat untouched for
 * hours with attempts still at zero.
 *
 * This is what the warden calls, on a schedule, so the next pass always comes.
 */
export async function drainEpisodeSearchesNow(budgetMs: number): Promise<boolean> {
  if (!isSonarrConfigured()) return false;
  await drainEpisodeSearches(Date.now() + budgetMs);
  return true;
}
/**
 * Searches a whole series in broadcast order -- season 1 episode 1 first,
 * then 2, 3, and on through later seasons -- so the show becomes watchable
 * from the beginning rather than from whichever episode happened to grab
 * first. Specials (season 0) go last; they're rarely what someone means by
 * "start watching this show".
 */
async function searchSeriesInEpisodeOrder(seriesId: number): Promise<void> {
  const episodes = await sonarrFetch<SonarrEpisode[]>(`/api/v3/episode?seriesId=${seriesId}`);
  const wanted = episodes
    .filter((e) => !e.hasFile)
    .sort((a, b) => {
      const sa = a.seasonNumber === 0 ? Number.MAX_SAFE_INTEGER : a.seasonNumber;
      const sb = b.seasonNumber === 0 ? Number.MAX_SAFE_INTEGER : b.seasonNumber;
      return sa - sb || a.episodeNumber - b.episodeNumber;
    });
  if (wanted.length === 0) return;

  // Monitor before searching. An explicit EpisodeSearch grabs regardless of
  // monitoring, so downloads would still start -- but an unmonitored episode
  // reads as "not wanted" everywhere else: it shows an idle Download button
  // while it waits its turn, and the idle-title healer skips it entirely, so
  // anything the search fails to find would never be retried.
  await sonarrFetch(`/api/v3/episode/monitor`, {
    method: "PUT",
    body: JSON.stringify({ episodeIds: wanted.map((e) => e.id), monitored: true }),
  });

  // Same split as a season request: the opening episodes individually, so
  // the show becomes watchable as fast as possible, then one SeriesSearch for
  // the rest. Searching a whole series an episode at a time is the same
  // fifteen-fold waste -- 147s per EpisodeSearch against ~10s per episode
  // when they are batched -- and a long-running show is hundreds of them.
  const ids = wanted.map((e) => e.id);
  await searchEpisodesInOrder(seriesId, ids.slice(0, LEAD_EPISODES));
  await recordBatchedEpisodes(seriesId, ids.slice(LEAD_EPISODES));

  if (ids.length > LEAD_EPISODES) {
    sonarrFetch(`/api/v3/command`, {
      method: "POST",
      body: JSON.stringify({ name: "SeriesSearch", seriesId }),
    }).catch((err) => {
      // The lead episodes are queued and the healer re-searches whatever is
      // still wanted, so a failed batch loses speed, not the request.
      console.error(`[sonarr] SeriesSearch failed for ${seriesId}:`, err);
    });
  }
}

/** Sonarr's full release search asks every indexer; it takes a minute or two. */
const SEASON_DEEP_SEARCH_TIMEOUT_MS = 180_000;
const seasonDeepSearching = new Set<string>();

/**
 * The second chance for a season no search can find anything for: grabs a
 * season pack Sonarr found but rejected only as "Unknown Series", telling it
 * which series the pack is -- see seasonDeepSearchRules.ts. Returns the title
 * grabbed, or null. One at a time per season.
 *
 * Only for a season with nothing on disk and nothing in flight, and only when
 * the search turned up nothing Sonarr would take by itself: a pack fetched
 * beside episodes already arriving would download the season twice.
 */
export async function deepSearchSonarrSeason(seriesId: number, seasonNumber: number): Promise<string | null> {
  if (!isSonarrConfigured()) return null;
  const key = `${seriesId}:${seasonNumber}`;
  if (seasonDeepSearching.has(key)) return null;
  seasonDeepSearching.add(key);
  try {
    const nothingYet = async (): Promise<number[] | null> => {
      const [episodes, queued] = await Promise.all([
        sonarrFetch<SonarrEpisode[]>(`/api/v3/episode?seriesId=${seriesId}&seasonNumber=${seasonNumber}`),
        episodesInQueue(),
      ]);
      const idle = episodes.every((e) => !e.hasFile && !queued.has(e.id));
      return episodes.length > 0 && idle ? episodes.map((e) => e.id) : null;
    };
    if (!(await nothingYet())) return null;

    const [series, releases] = await Promise.all([
      sonarrFetch<{
        title: string;
        year: number;
        alternateTitles?: { title?: string }[];
        originalLanguage?: { id: number; name?: string };
      }>(`/api/v3/series/${seriesId}`),
      sonarrFetch<SeasonRelease[]>(`/api/v3/release?seriesId=${seriesId}&seasonNumber=${seasonNumber}`, {
        signal: AbortSignal.timeout(SEASON_DEEP_SEARCH_TIMEOUT_MS),
      }),
    ]);
    // Something Sonarr accepts is the ordinary search's to grab.
    if (releases.some((r) => !r.rejected)) return null;
    const pick = pickUnmatchedSeasonPack(releases, {
      titles: [series.title, ...(series.alternateTitles ?? []).map((a) => a.title ?? "")].filter(Boolean),
      year: series.year,
      seasonNumber,
    });
    if (!pick) return null;

    // Read again: the search above took a minute, and a grab may have landed.
    const episodeIds = await nothingYet();
    if (!episodeIds) return null;
    // Sonarr's "Override and Grab": the release as found, with the series,
    // episodes, quality and languages stated rather than parsed.
    await sonarrFetch(`/api/v3/release`, {
      method: "POST",
      body: JSON.stringify({
        guid: pick.guid,
        indexerId: pick.indexerId,
        shouldOverride: true,
        seriesId,
        episodeIds,
        quality: pick.quality,
        languages: overrideLanguages(pick, series.originalLanguage),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    console.log(
      `[sonarr] deep search grabbed "${pick.title}" for series ${seriesId} S${seasonNumber} (Sonarr had it as Unknown Series)`
    );
    return pick.title;
  } finally {
    seasonDeepSearching.delete(key);
  }
}

/**
 * The same second chance for one episode: a release of that episode Sonarr
 * rejected only as "Unknown Series" -- or, when the only copy anywhere is a
 * season pack named that way, the pack, for every episode of the season
 * still missing. A larger download than was asked for beats none at all.
 * Returns the title grabbed, or null.
 */
export async function deepSearchSonarrEpisode(seriesId: number, episodeId: number): Promise<string | null> {
  if (!isSonarrConfigured()) return null;
  const key = `episode:${episodeId}`;
  if (seasonDeepSearching.has(key)) return null;
  seasonDeepSearching.add(key);
  try {
    const stillMissing = async (): Promise<(SonarrEpisode & { seriesId?: number }) | null> => {
      const [episode, queued] = await Promise.all([
        sonarrFetch<SonarrEpisode>(`/api/v3/episode/${episodeId}`),
        episodesInQueue(),
      ]);
      return !episode.hasFile && !queued.has(episode.id) ? episode : null;
    };
    const episode = await stillMissing();
    if (!episode) return null;

    const [series, releases] = await Promise.all([
      sonarrFetch<{
        title: string;
        year: number;
        alternateTitles?: { title?: string }[];
        originalLanguage?: { id: number; name?: string };
      }>(`/api/v3/series/${seriesId}`),
      sonarrFetch<SeasonRelease[]>(`/api/v3/release?episodeId=${episodeId}`, {
        signal: AbortSignal.timeout(SEASON_DEEP_SEARCH_TIMEOUT_MS),
      }),
    ]);
    if (releases.some((r) => !r.rejected)) return null;
    const target = {
      titles: [series.title, ...(series.alternateTitles ?? []).map((a) => a.title ?? "")].filter(Boolean),
      year: series.year,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
    };
    const single = pickUnmatchedEpisode(releases, target);
    const pick = single ?? pickUnmatchedSeasonPack(releases, target);
    if (!pick) return null;
    if (!(await stillMissing())) return null;

    let episodeIds = [episodeId];
    if (!single) {
      const [season, queued] = await Promise.all([
        sonarrFetch<SonarrEpisode[]>(`/api/v3/episode?seriesId=${seriesId}&seasonNumber=${episode.seasonNumber}`),
        episodesInQueue(),
      ]);
      episodeIds = season.filter((e) => !e.hasFile && !queued.has(e.id)).map((e) => e.id);
      if (!episodeIds.includes(episodeId)) return null;
    }
    await sonarrFetch(`/api/v3/release`, {
      method: "POST",
      body: JSON.stringify({
        guid: pick.guid,
        indexerId: pick.indexerId,
        shouldOverride: true,
        seriesId,
        episodeIds,
        quality: pick.quality,
        languages: overrideLanguages(pick, series.originalLanguage),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    console.log(
      `[sonarr] deep search grabbed "${pick.title}" for episode ${episodeId} (Sonarr had it as Unknown Series)`
    );
    return pick.title;
  } finally {
    seasonDeepSearching.delete(key);
  }
}

/** Monitors and searches every episode in one season. */
export async function requestSeason(
  tmdbId: string,
  seasonNumber: number,
  tier: QualityTier = "hd"
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSonarrConfigured()) return { ok: false, error: "Sonarr is not configured" };
  try {
    const series = await ensureSeriesInSonarr(tmdbId, tier);
    if (!series.ok) return series;

    // Monitor the season itself so future episodes are picked up too.
    const full = await sonarrFetch<{ seasons: { seasonNumber: number; monitored: boolean }[] }>(
      `/api/v3/series/${series.sonarrId}`
    );
    const updated = {
      ...full,
      seasons: full.seasons.map((s) =>
        s.seasonNumber === seasonNumber ? { ...s, monitored: true } : s
      ),
    };
    await sonarrFetch(`/api/v3/series/${series.sonarrId}`, {
      method: "PUT",
      body: JSON.stringify(updated),
    });

    const episodes = await episodesWhenReady(
      series.sonarrId,
      seasonNumber,
      series.created
    );
    const inOrder = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
    const ids = inOrder.map((e) => e.id);
    // An error, not a silent ok. Reporting success for a request that queued
    // nothing left the row showing "Starting..." for a season that was never
    // going to start, which is harder to diagnose than a plain failure.
    if (ids.length === 0) {
      return { ok: false, error: "Sonarr has no episodes for this season yet" };
    }

    await sonarrFetch(`/api/v3/episode/monitor`, {
      method: "PUT",
      body: JSON.stringify({ episodeIds: ids, monitored: true }),
    });

    // The opening episodes go through the ordered queue; everything else goes
    // out as one SeasonSearch.
    //
    // Measured on this setup: a single EpisodeSearch takes 147s, while one
    // SeasonSearch covering 21 episodes takes 208s. Per episode that is 147s
    // against 10s, because the cost is Sonarr's per-search overhead -- eight
    // indexers queried and ~300 releases scored, once per search, regardless
    // of how many episodes the search is for.
    //
    // Searching a season an episode at a time therefore cost roughly fifteen
    // times what it needed to. A 13-episode season was half an hour of
    // searching before the last episode was even looked for.
    //
    // The ordered queue is still what makes a show watchable from the start,
    // so the opening episodes keep it: they are searched individually and
    // first, which gets episode 1 grabbed in ~147s rather than waiting on a
    // 208s batch. The batch then fetches the rest in one go, and the drain
    // skips anything the batch already has in flight.
    const lead = ids.slice(0, LEAD_EPISODES);
    const rest = ids.slice(LEAD_EPISODES);
    await searchEpisodesInOrder(series.sonarrId, lead);
    await recordBatchedEpisodes(series.sonarrId, rest);

    if (rest.length > 0) {
      // Fire-and-forget, and deliberately not part of the ordered queue: this
      // is one command for the whole season, and waiting on it would make the
      // request block for the length of a full search.
      sonarrFetch(`/api/v3/command`, {
        method: "POST",
        body: JSON.stringify({
          name: "SeasonSearch",
          seriesId: series.sonarrId,
          seasonNumber,
        }),
      }).catch((err) => {
        // The lead episodes are already queued, and the healer re-searches
        // anything still wanted, so a failed batch degrades to the old
        // behaviour rather than losing the season.
        console.error(`[sonarr] SeasonSearch failed for ${seasonNumber}:`, err);
      });
    }
    // Alongside, not after: the ordinary search can only report "nothing" for
    // a pack Sonarr cannot place, and a viewer who just asked should not wait
    // on the healer's second idle retry to find that out. Never awaited.
    void deepSearchSonarrSeason(series.sonarrId, seasonNumber).catch((err) =>
      console.error(`[sonarr] season deep search failed for ${tmdbId} S${seasonNumber}:`, err)
    );
    return { ok: true };
  } catch (err) {
    console.error(`[sonarr] requestSeason failed for ${tmdbId} S${seasonNumber}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Sonarr error" };
  }
}

/**
 * Cancels in-flight downloads and/or removes downloaded files for a single
 * episode, or for a whole season when `episodeNumber` is omitted. Also
 * unmonitors what it clears, so Sonarr doesn't immediately re-grab it on the
 * next RSS pass -- "cancel" should mean cancelled, not "retry shortly".
 */
export async function manageSonarrEpisodes(
  tmdbId: string,
  seasonNumber: number,
  episodeNumber: number | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSonarrConfigured()) return { ok: false, error: "Sonarr is not configured" };
  try {
    const { tvdbId } = await getTvExternalIds(tmdbId);
    if (!tvdbId) return { ok: false, error: "No TVDB id found for this show on TMDB" };
    const series = await sonarrFetch<{ id: number }[]>(`/api/v3/series?tvdbId=${tvdbId}`);
    if (!series[0]) return { ok: false, error: "Show is not in Sonarr" };
    const seriesId = series[0].id;

    const allEpisodes = await sonarrFetch<(SonarrEpisode & { episodeFileId?: number })[]>(
      `/api/v3/episode?seriesId=${seriesId}&seasonNumber=${seasonNumber}`
    );
    const targets =
      episodeNumber == null
        ? allEpisodes
        : allEpisodes.filter((e) => e.episodeNumber === episodeNumber);
    if (targets.length === 0) return { ok: false, error: "Episode not found in Sonarr" };
    const targetIds = new Set(targets.map((e) => e.id));

    // Collected before the files go, since deleting clears the history trail
    // we need to find the still-seeding torrent.
    const downloadIds = await getSonarrDownloadIds(targets.map((e) => e.id));

    // Stop wanting them *before* touching the queue, so nothing removed below
    // is simply grabbed again: unmonitor, drop queued searches, and stop any
    // search already running for them (it would grab regardless of monitoring).
    await sonarrFetch(`/api/v3/episode/monitor`, {
      method: "PUT",
      body: JSON.stringify({ episodeIds: targets.map((e) => e.id), monitored: false }),
    });
    await (await searchQueue()).clearPendingSearches(targets.map((e) => e.id));
    await stopEpisodeSearches(
      targets.map((e) => e.id),
      episodeNumber == null ? { seriesId, seasonNumber } : null
    );

    // Drop anything currently downloading for these episodes.
    const dropQueued = async () => {
      const queue = await sonarrFetch<{ records: { id: number; episodeId?: number }[] }>(
        `/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`
      );
      for (const record of queue.records) {
        if (record.episodeId != null && targetIds.has(record.episodeId)) {
          await sonarrFetch(`/api/v3/queue/${record.id}?removeFromClient=true&blocklist=false`, {
            method: "DELETE",
          });
        }
      }
    };
    await dropQueued();

    // Remove any already-imported files.
    for (const ep of targets) {
      if (ep.episodeFileId) {
        await sonarrFetch(`/api/v3/episodefile/${ep.episodeFileId}`, { method: "DELETE" });
      }
    }

    // A grab that was already in flight lands a moment after the first pass.
    await new Promise((resolve) => setTimeout(resolve, CANCEL_SWEEP_DELAY_MS));
    await dropQueued();

    // Unmonitor the season too, otherwise Sonarr treats it as still wanted.
    if (episodeNumber == null) {
      const full = await sonarrFetch<{ seasons: { seasonNumber: number; monitored: boolean }[] }>(
        `/api/v3/series/${seriesId}`
      );
      await sonarrFetch(`/api/v3/series/${seriesId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...full,
          seasons: full.seasons.map((s) =>
            s.seasonNumber === seasonNumber ? { ...s, monitored: false } : s
          ),
        }),
      });
    }

    // Sonarr stops tracking a torrent once it's imported, so removing the
    // episode leaves it seeding in the download client -- gone from Streamy
    // but still listed in qBittorrent. Finish the job here.
    if (downloadIds.length > 0) await deleteTorrents(downloadIds);

    return { ok: true };
  } catch (err) {
    console.error(`[sonarr] manageSonarrEpisodes failed for ${tmdbId} S${seasonNumber}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Sonarr error" };
  }
}

export type SonarrRequestResult =
  | { ok: true; sonarrId: number; tvdbId: number; status: MediaRequestStatus }
  | { ok: false; error: string };

/**
 * Resolves TMDB id -> TVDB id, looks the show up in Sonarr, adds it, and
 * triggers a search. If it's already in Sonarr (e.g. added directly in
 * Sonarr's own UI, or a prior request Streamy lost track of), skips
 * straight to reporting its real current status instead of erroring on
 * Sonarr's duplicate-add rejection.
 */
export async function requestShow(
  tmdbId: string,
  tier: QualityTier = "hd"
): Promise<SonarrRequestResult> {
  if (!isSonarrConfigured()) return { ok: false, error: "Sonarr is not configured" };

  try {
    const { tvdbId } = await getTvExternalIds(tmdbId);
    if (!tvdbId) return { ok: false, error: "No TVDB id found for this show on TMDB" };

    const existing = await sonarrFetch<
      { id: number; statistics?: { episodeFileCount?: number } }[]
    >(`/api/v3/series?tvdbId=${tvdbId}`);
    if (existing[0]) {
      const status = await resolveSonarrStatus(existing[0]);
      if (status === "requested") {
        // Already in Sonarr but neither downloading nor available -- e.g. a
        // prior download was cancelled outside Streamy. resolveSonarrStatus
        // alone would silently report "requested" with nothing actually
        // searching, so kick off a fresh search here.
        await searchSeriesInEpisodeOrder(existing[0].id);
      }
      return { ok: true, sonarrId: existing[0].id, tvdbId, status };
    }

    const lookup = await sonarrFetch<Record<string, unknown>[]>(
      `/api/v3/series/lookup?term=tvdb:${tvdbId}`
    );
    const match = lookup[0];
    if (!match) return { ok: false, error: "Show not found via Sonarr lookup" };

    const seasons = Array.isArray(match.seasons)
      ? (match.seasons as { seasonNumber: number }[]).map((s) => ({
          seasonNumber: s.seasonNumber,
          monitored: true,
        }))
      : [];

    const created = await sonarrFetch<{ id: number }>(`/api/v3/series`, {
      method: "POST",
      body: JSON.stringify({
        ...match,
        tvdbId,
        qualityProfileId: resolveQualityProfileId(
        tier,
        SONARR_QUALITY_PROFILE_ID,
        SONARR_QUALITY_PROFILE_ID_4K
      ),
        rootFolderPath: SONARR_ROOT_FOLDER,
        monitored: true,
        // Sonarr's own bulk search grabs the whole show at once, in no
        // particular order; we drive an ordered search instead.
        addOptions: { searchForMissingEpisodes: false },
        seasons,
      }),
    });
    await searchSeriesInEpisodeOrder(created.id);
    return { ok: true, sonarrId: created.id, tvdbId, status: "requested" };
  } catch (err) {
    console.error(`[sonarr] requestShow failed for tmdbId ${tmdbId}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Sonarr error" };
  }
}

/** Sonarr's own self-reported integration health. See getRadarrHealthIssues for the rationale. */
export async function getSonarrHealthIssues(): Promise<RadarrHealthIssue[]> {
  if (!isSonarrConfigured()) return [];
  try {
    const issues = await sonarrFetch<{ source: string; message: string; type: string }[]>(
      "/api/v3/health"
    );
    return issues
      .filter((i) => i.type === "error" || i.type === "warning")
      .map((i) => ({ source: i.source, message: i.message, type: i.type as "error" | "warning" }));
  } catch (err) {
    console.error("[sonarr] getSonarrHealthIssues failed:", err);
    return [];
  }
}

/** See getRadarrStuckImports/isConfidenceBlockedQueueItem for the rationale -- the same check, on Sonarr's queue. */
export async function getSonarrStuckImports(): Promise<string[]> {
  if (!isSonarrConfigured()) return [];
  try {
    const queue = await sonarrFetch<{
      records: (QueueItemForImportCheck & { title: string })[];
    }>("/api/v3/queue?pageSize=250");
    return queue.records.filter(isConfidenceBlockedQueueItem).map((r) => r.title);
  } catch (err) {
    console.error("[sonarr] getSonarrStuckImports failed:", err);
    return [];
  }
}

/**
 * Why episode downloads go the way they go.
 *
 * The same read as Radarr's, against Sonarr. Worth having separately rather
 * than assuming they match: the delay profile, the enabled indexers and the
 * grab history are all per-app, so films and episodes can route differently
 * and did not necessarily get configured at the same time.
 */
export async function getSonarrDownloadRouting(): Promise<DownloadRouting | null> {
  if (!isSonarrConfigured()) return null;
  return readDownloadRouting((path) => sonarrFetch(path), "sonarr");
}
