/**
 * Sonarr API client (server-side only). Set SONARR_URL/SONARR_API_KEY/
 * SONARR_ROOT_FOLDER/SONARR_QUALITY_PROFILE_ID in env to enable.
 * Sonarr is keyed by TVDB id, not TMDB — requestShow() resolves the TVDB id
 * via TMDB's own external_ids endpoint first, so this is still deterministic
 * ID matching, never fuzzy title search.
 */

import { getTvExternalIds } from "./tmdb";
import { deleteTorrents } from "./qbittorrent";
import { expireBlocklist } from "./radarr";
import { computeProgress } from "./radarr";
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

export function isSonarrConfigured(): boolean {
  return !!(
    SONARR_URL &&
    SONARR_API_KEY &&
    SONARR_ROOT_FOLDER &&
    SONARR_QUALITY_PROFILE_ID &&
    !Number.isNaN(Number(SONARR_QUALITY_PROFILE_ID))
  );
}

async function sonarrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SONARR_URL}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": SONARR_API_KEY!,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sonarr API error: ${res.status} ${body}`.trim());
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Any episode file on disk means "available"; otherwise check the active queue. */
async function resolveSonarrStatus(series: {
  id: number;
  statistics?: { episodeFileCount?: number };
}): Promise<MediaRequestStatus> {
  if ((series.statistics?.episodeFileCount ?? 0) > 0) return "available";
  const queue = await sonarrFetch<{ records: { seriesId: number }[] }>(`/api/v3/queue`);
  return queue.records.some((r) => r.seriesId === series.id) ? "downloading" : "requested";
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
      `/api/v3/queue`
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
      records: { id: number; seriesId: number; title: string; size: number; sizeleft: number }[];
    }>(`/api/v3/queue`);
    return queue.records.map((r) => ({
      queueId: r.id,
      externalId: r.seriesId,
      title: r.title,
      progress: computeProgress(r.size, r.sizeleft),
    }));
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
};

/**
 * Every downloaded episode, listed individually.
 *
 * Deliberately per-episode rather than per-series: movies appear one row per
 * film, so collapsing a whole show into a single "Severance" row made TV look
 * like it was missing from the panel, and left no way to delete one episode
 * without taking the entire series with it.
 */
export async function getSonarrCompletedEpisodes(): Promise<CompletedEpisode[]> {
  if (!isSonarrConfigured()) return [];
  try {
    const series = await sonarrFetch<
      { id: number; title: string; statistics?: { episodeFileCount?: number } }[]
    >("/api/v3/series");

    const withFiles = series.filter((s) => (s.statistics?.episodeFileCount ?? 0) > 0);
    const perSeries = await Promise.all(
      withFiles.map(async (s) => {
        const episodes = await sonarrFetch<
          { id: number; seasonNumber: number; episodeNumber: number; title: string; hasFile: boolean }[]
        >(`/api/v3/episode?seriesId=${s.id}`);
        return episodes
          .filter((e) => e.hasFile)
          .map((e) => ({
            episodeId: e.id,
            seriesId: s.id,
            title: `${s.title} · S${e.seasonNumber} E${e.episodeNumber}${e.title ? ` · ${e.title}` : ""}`,
          }));
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
 * Cancels a series' active download in Sonarr and removes it (and any partial
 * data) from the client. `blocklist` marks the specific release as bad so
 * Sonarr won't immediately re-grab it -- used when auto-healing a stalled or
 * errored download, but not for a plain user-initiated cancel.
 */
export async function cancelSonarrDownload(sonarrId: number, blocklist = false): Promise<boolean> {
  if (!isSonarrConfigured()) return false;
  try {
    const queue = await sonarrFetch<{ records: { id: number; seriesId: number }[] }>(`/api/v3/queue`);
    // A series can legitimately have several episodes in flight at once.
    const entries = queue.records.filter((r) => r.seriesId === sonarrId);
    for (const entry of entries) {
      await sonarrFetch(
        `/api/v3/queue/${entry.id}?removeFromClient=true&blocklist=${blocklist}`,
        { method: "DELETE" }
      );
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

/** Kicks off a fresh release search for a series already in Sonarr. */
export async function searchSonarrSeries(sonarrId: number): Promise<void> {
  if (!isSonarrConfigured()) return;
  await sonarrFetch(`/api/v3/command`, {
    method: "POST",
    body: JSON.stringify({ name: "SeriesSearch", seriesId: sonarrId }),
  });
}

const COMMAND_POLL_MS = 2000;
const COMMAND_TIMEOUT_MS = 90_000;

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
async function waitForSonarrCommand(commandId: number): Promise<void> {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const cmd = await sonarrFetch<{ status: string }>(`/api/v3/command/${commandId}`);
      if (cmd.status === "completed" || cmd.status === "failed" || cmd.status === "aborted") {
        return;
      }
    } catch {
      return; // treat an unreadable command as done rather than stalling the chain
    }
    await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_MS));
  }
}

/**
 * Episodes Sonarr still wants but has nothing in flight for: monitored, no
 * file, aired, and absent from the queue. Same failure shape as the Radarr
 * side -- a search that found nothing leaves the episode sitting in
 * "searching" forever with no search actually running.
 */
export async function getIdleWantedEpisodes(): Promise<{ episodeId: number; title: string }[]> {
  if (!isSonarrConfigured()) return [];
  try {
    const [wanted, queue] = await Promise.all([
      sonarrFetch<{
        records: { id: number; title: string; seriesId: number; monitored: boolean }[];
      }>(`/api/v3/wanted/missing?pageSize=50&sortKey=airDateUtc&sortDirection=descending`),
      sonarrFetch<{ records: { episodeId?: number }[] }>(`/api/v3/queue`),
    ]);
    const queued = new Set(
      queue.records.map((r) => r.episodeId).filter((id): id is number => id != null)
    );
    return wanted.records
      .filter((e) => e.monitored && !queued.has(e.id))
      .map((e) => ({ episodeId: e.id, title: e.title }));
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
export async function expireSonarrBlocklist(maxAgeHours: number): Promise<number> {
  if (!isSonarrConfigured()) return 0;
  return expireBlocklist(sonarrFetch, maxAgeHours, "sonarr");
}

/** Cancels one specific queued download, leaving the series' other episodes alone. */
export async function cancelSonarrQueueItem(queueId: number): Promise<boolean> {
  if (!isSonarrConfigured()) return false;
  try {
    await sonarrFetch(`/api/v3/queue/${queueId}?removeFromClient=true&blocklist=false`, {
      method: "DELETE",
    });
    return true;
  } catch (err) {
    console.error(`[sonarr] cancelSonarrQueueItem failed for ${queueId}:`, err);
    return false;
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
        seriesId: number;
        title: string;
        size: number;
        sizeleft: number;
        added?: string;
        errorMessage?: string;
        status?: string;
      }[];
    }>(`/api/v3/queue`);
    return queue.records.map((r) => {
      const added = r.added ? Date.parse(r.added) : Date.now();
      return {
        externalId: r.seriesId,
        title: r.title,
        errorMessage:
          r.errorMessage ?? (r.status === "warning" || r.status === "failed" ? r.status : null),
        ageMinutes: (Date.now() - added) / 60000,
        hasProgress: r.size > 0 && r.sizeleft < r.size,
      };
    });
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
async function ensureSeriesInSonarr(tmdbId: string): Promise<
  { ok: true; sonarrId: number } | { ok: false; error: string }
> {
  const { tvdbId } = await getTvExternalIds(tmdbId);
  if (!tvdbId) return { ok: false, error: "No TVDB id found for this show on TMDB" };

  const existing = await sonarrFetch<{ id: number }[]>(`/api/v3/series?tvdbId=${tvdbId}`);
  if (existing[0]) return { ok: true, sonarrId: existing[0].id };

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
      qualityProfileId: Number(SONARR_QUALITY_PROFILE_ID),
      rootFolderPath: SONARR_ROOT_FOLDER,
      monitored: true,
      addOptions: { searchForMissingEpisodes: false },
      seasons,
    }),
  });
  return { ok: true, sonarrId: created.id };
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

export type EpisodeState = {
  status: MediaRequestStatus;
  /** 0-100 while downloading; null when not started or metadata unresolved. */
  progress: number | null;
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
    }>(`/api/v3/queue`);
    const queued = new Map<number, { size: number; sizeleft: number }>();
    for (const r of queue.records) {
      if (r.episodeId != null) queued.set(r.episodeId, { size: r.size, sizeleft: r.sizeleft });
    }

    const statuses: EpisodeStatusMap = {};
    for (const ep of episodes) {
      const q = queued.get(ep.id);
      if (ep.hasFile) {
        statuses[ep.episodeNumber] = { status: "available", progress: null };
      } else if (q) {
        statuses[ep.episodeNumber] = {
          status: "downloading",
          progress: q.size > 0 ? Math.round(((q.size - q.sizeleft) / q.size) * 100) : null,
        };
      } else if (ep.monitored) {
        statuses[ep.episodeNumber] = { status: "requested", progress: null };
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
  episodeNumber: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSonarrConfigured()) return { ok: false, error: "Sonarr is not configured" };
  try {
    const series = await ensureSeriesInSonarr(tmdbId);
    if (!series.ok) return series;

    const episodes = await sonarrFetch<SonarrEpisode[]>(
      `/api/v3/episode?seriesId=${series.sonarrId}&seasonNumber=${seasonNumber}`
    );
    const episode = episodes.find((e) => e.episodeNumber === episodeNumber);
    if (!episode) return { ok: false, error: "Episode not found in Sonarr" };

    await sonarrFetch(`/api/v3/episode/monitor`, {
      method: "PUT",
      body: JSON.stringify({ episodeIds: [episode.id], monitored: true }),
    });
    await sonarrFetch(`/api/v3/command`, {
      method: "POST",
      body: JSON.stringify({ name: "EpisodeSearch", episodeIds: [episode.id] }),
    });
    return { ok: true };
  } catch (err) {
    console.error(`[sonarr] requestEpisode failed for ${tmdbId} S${seasonNumber}E${episodeNumber}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Sonarr error" };
  }
}

/**
 * Searches the given episodes one at a time, in the order supplied, waiting
 * for each grab to finish before starting the next so downloads queue up in
 * episode order. Runs detached from the request that started it.
 */
async function searchEpisodesInOrder(episodeIds: number[]): Promise<void> {
  for (const id of episodeIds) {
    try {
      // Re-check before each search rather than trusting the list we started
      // with. This chain runs for minutes after the request that began it, so
      // an episode can be cancelled part-way through -- and an explicit
      // EpisodeSearch grabs regardless of monitoring, so without this the
      // cancelled episode would simply start downloading again when its turn
      // came round. Unmonitored means cancelled: skip it.
      const episode = await sonarrFetch<{ monitored: boolean; hasFile: boolean }>(
        `/api/v3/episode/${id}`
      );
      if (!episode.monitored || episode.hasFile) continue;

      const cmd = await sonarrFetch<{ id: number }>(`/api/v3/command`, {
        method: "POST",
        body: JSON.stringify({ name: "EpisodeSearch", episodeIds: [id] }),
      });
      await waitForSonarrCommand(cmd.id);
    } catch (err) {
      // One episode failing shouldn't strand the rest of the season.
      console.error(`[sonarr] ordered search failed for episode ${id}:`, err);
    }
  }
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

  void searchEpisodesInOrder(wanted.map((e) => e.id));
}

/** Monitors and searches every episode in one season. */
export async function requestSeason(
  tmdbId: string,
  seasonNumber: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSonarrConfigured()) return { ok: false, error: "Sonarr is not configured" };
  try {
    const series = await ensureSeriesInSonarr(tmdbId);
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

    const episodes = await sonarrFetch<SonarrEpisode[]>(
      `/api/v3/episode?seriesId=${series.sonarrId}&seasonNumber=${seasonNumber}`
    );
    const inOrder = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
    const ids = inOrder.map((e) => e.id);
    if (ids.length === 0) return { ok: true };

    await sonarrFetch(`/api/v3/episode/monitor`, {
      method: "PUT",
      body: JSON.stringify({ episodeIds: ids, monitored: true }),
    });

    // Deliberately not SeasonSearch: that grabs the whole season at once and
    // the download client starts them in whatever order the grabs land, so
    // episode 1 can finish last. Instead each episode is searched in
    // ascending order and we wait for each grab before starting the next, so
    // torrents enter the download client in episode order and the season
    // becomes watchable from episode 1 onward.
    //
    // Not awaited: a full season is minutes of sequential searching, far
    // longer than a request should block. The chain runs in the background
    // and the UI picks up each episode as it appears via status polling.
    void searchEpisodesInOrder(ids);
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

    // Drop anything currently downloading for these episodes.
    const queue = await sonarrFetch<{ records: { id: number; episodeId?: number }[] }>(
      `/api/v3/queue`
    );
    for (const record of queue.records) {
      if (record.episodeId != null && targetIds.has(record.episodeId)) {
        await sonarrFetch(
          `/api/v3/queue/${record.id}?removeFromClient=true&blocklist=false`,
          { method: "DELETE" }
        );
      }
    }

    // Remove any already-imported files.
    for (const ep of targets) {
      if (ep.episodeFileId) {
        await sonarrFetch(`/api/v3/episodefile/${ep.episodeFileId}`, { method: "DELETE" });
      }
    }

    await sonarrFetch(`/api/v3/episode/monitor`, {
      method: "PUT",
      body: JSON.stringify({ episodeIds: targets.map((e) => e.id), monitored: false }),
    });

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
export async function requestShow(tmdbId: string): Promise<SonarrRequestResult> {
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
        qualityProfileId: Number(SONARR_QUALITY_PROFILE_ID),
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
