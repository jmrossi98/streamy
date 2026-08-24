/**
 * Radarr API client (server-side only). Set RADARR_URL/RADARR_API_KEY/
 * RADARR_ROOT_FOLDER/RADARR_QUALITY_PROFILE_ID in env to enable.
 * Radarr is keyed natively by TMDB id, so requests are a direct ID lookup —
 * no title matching involved.
 */

import { deleteTorrents } from "./qbittorrent";

const RADARR_URL = process.env.RADARR_URL?.replace(/\/$/, "");
const RADARR_API_KEY = process.env.RADARR_API_KEY;
const RADARR_ROOT_FOLDER = process.env.RADARR_ROOT_FOLDER;
const RADARR_QUALITY_PROFILE_ID = process.env.RADARR_QUALITY_PROFILE_ID;

export function isRadarrConfigured(): boolean {
  return !!(
    RADARR_URL &&
    RADARR_API_KEY &&
    RADARR_ROOT_FOLDER &&
    RADARR_QUALITY_PROFILE_ID &&
    !Number.isNaN(Number(RADARR_QUALITY_PROFILE_ID))
  );
}

async function radarrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RADARR_URL}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": RADARR_API_KEY!,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Radarr API error: ${res.status} ${body}`.trim());
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export type MediaRequestStatus = "requested" | "downloading" | "available";

/** hasFile means Radarr already imported a file; otherwise check the active queue. */
async function resolveRadarrStatus(movie: { id: number; hasFile: boolean }): Promise<MediaRequestStatus> {
  if (movie.hasFile) return "available";
  const queue = await radarrFetch<{ records: { movieId: number }[] }>(`/api/v3/queue`);
  return queue.records.some((r) => r.movieId === movie.id) ? "downloading" : "requested";
}

export type RadarrStorageInfo = { totalSpace: number; freeSpace: number; moviesSize: number };

/** Disk usage for the mount backing RADARR_ROOT_FOLDER, plus total size of movies on disk. */
export async function getRadarrStorageInfo(): Promise<RadarrStorageInfo | null> {
  if (!isRadarrConfigured()) return null;
  try {
    const [diskspace, movies] = await Promise.all([
      radarrFetch<{ path: string; freeSpace: number; totalSpace: number }[]>("/api/v3/diskspace"),
      radarrFetch<{ sizeOnDisk?: number }[]>("/api/v3/movie"),
    ]);
    const mount =
      diskspace.find((d) => RADARR_ROOT_FOLDER?.startsWith(d.path)) ?? diskspace[0];
    if (!mount) return null;
    const moviesSize = movies.reduce((sum, m) => sum + (m.sizeOnDisk ?? 0), 0);
    return { totalSpace: mount.totalSpace, freeSpace: mount.freeSpace, moviesSize };
  } catch (err) {
    console.error("[radarr] getRadarrStorageInfo failed:", err);
    return null;
  }
}

/** "cancelled" = Radarr no longer wants it, which is distinct from still searching. */
export type LiveStatus = MediaRequestStatus | "cancelled";

/**
 * Live status for a movie looked up by TMDB id, without needing a local
 * MediaRequest row. Radarr can be downloading something Streamy has no row
 * for -- the auto-healer starts searches on its own, and rows get cleared
 * when a title looks idle -- so the button has to be able to read Radarr
 * directly rather than treating "no row" as "not requested".
 */
export async function getRadarrStatusByTmdbId(tmdbId: string): Promise<{
  status: MediaRequestStatus;
  radarrId: number;
} | null> {
  if (!isRadarrConfigured()) return null;
  try {
    const movies = await radarrFetch<{ id: number; hasFile: boolean; monitored: boolean }[]>(
      `/api/v3/movie?tmdbId=${tmdbId}`
    );
    const movie = movies[0];
    if (!movie) return null;
    if (movie.hasFile) return { status: "available", radarrId: movie.id };

    const queue = await radarrFetch<{ records: { movieId: number }[] }>(`/api/v3/queue`);
    if (queue.records.some((r) => r.movieId === movie.id)) {
      return { status: "downloading", radarrId: movie.id };
    }
    // In Radarr but idle: only "requested" if it's actually still wanted.
    return movie.monitored ? { status: "requested", radarrId: movie.id } : null;
  } catch (err) {
    console.error(`[radarr] getRadarrStatusByTmdbId failed for ${tmdbId}:`, err);
    return null;
  }
}

/**
 * Re-derives a movie's live status straight from Radarr, bypassing whatever
 * Streamy's own MediaRequest row currently says. Used to catch downloads that
 * were cancelled or removed outside Streamy's request flow, since the webhook
 * that would normally flip status never fires for that.
 *
 * An unmonitored movie with no file is reported as "cancelled" rather than
 * "requested": Radarr never searches for something it isn't monitoring, so
 * calling that state "searching" leaves the button spinning on a search that
 * will never happen.
 */
export async function getRadarrLiveStatus(radarrId: number): Promise<LiveStatus | null> {
  if (!isRadarrConfigured()) return null;
  try {
    const movie = await radarrFetch<{ id: number; hasFile: boolean; monitored: boolean }>(
      `/api/v3/movie/${radarrId}`
    );
    if (movie.hasFile) return "available";
    if (!movie.monitored) return "cancelled";
    return resolveRadarrStatus(movie);
  } catch (err) {
    console.error(`[radarr] getRadarrLiveStatus failed for ${radarrId}:`, err);
    return null;
  }
}

/** Live download percent (0-100) for a movie currently in Radarr's active queue. */
export async function getRadarrDownloadProgress(radarrId: number): Promise<number | null> {
  if (!isRadarrConfigured()) return null;
  try {
    const queue = await radarrFetch<{ records: { movieId: number; size: number; sizeleft: number }[] }>(
      `/api/v3/queue`
    );
    const entry = queue.records.find((r) => r.movieId === radarrId);
    if (!entry || !entry.size) return null;
    return Math.round(((entry.size - entry.sizeleft) / entry.size) * 100);
  } catch (err) {
    console.error("[radarr] getRadarrDownloadProgress failed:", err);
    return null;
  }
}

// progress is null while the torrent's metadata (and therefore its real
// size) hasn't resolved yet -- distinct from 0%, which would wrongly imply
// data transfer has actually started.
//
// `queueId` identifies this specific download; `externalId` is the
// movie/series it belongs to. They have to be separate: a series can have
// several episodes downloading at once, so keying rows by the series id
// alone collapsed every episode of a show into a single row.
export type ActiveDownload = {
  queueId: number;
  externalId: number;
  title: string;
  progress: number | null;
};

/** Every movie currently in Radarr's active download queue, with live progress. */
export async function getRadarrActiveDownloads(): Promise<ActiveDownload[]> {
  if (!isRadarrConfigured()) return [];
  try {
    const queue = await radarrFetch<{
      records: { id: number; movieId: number; title: string; size: number; sizeleft: number }[];
    }>(`/api/v3/queue`);
    return queue.records.map((r) => ({
      queueId: r.id,
      externalId: r.movieId,
      title: r.title,
      progress: r.size > 0 ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : null,
    }));
  } catch (err) {
    console.error("[radarr] getRadarrActiveDownloads failed:", err);
    return [];
  }
}

/** Cancels one specific queued download, leaving a series' other episodes alone. */
export async function cancelRadarrQueueItem(queueId: number): Promise<boolean> {
  if (!isRadarrConfigured()) return false;
  try {
    await radarrFetch(`/api/v3/queue/${queueId}?removeFromClient=true&blocklist=false`, {
      method: "DELETE",
    });
    return true;
  } catch (err) {
    console.error(`[radarr] cancelRadarrQueueItem failed for ${queueId}:`, err);
    return false;
  }
}

export type CompletedDownload = { id: number; title: string };

/** Every movie Radarr has fully downloaded, for the admin panel's completed section. */
export async function getRadarrCompletedMovies(): Promise<CompletedDownload[]> {
  if (!isRadarrConfigured()) return [];
  try {
    const movies = await radarrFetch<{ id: number; title: string; hasFile: boolean }[]>("/api/v3/movie");
    return movies.filter((m) => m.hasFile).map((m) => ({ id: m.id, title: m.title }));
  } catch (err) {
    console.error("[radarr] getRadarrCompletedMovies failed:", err);
    return [];
  }
}

/**
 * Cancels a movie's active download in Radarr and removes it (and any partial
 * data) from the client. `blocklist` marks the specific release as bad so
 * Radarr won't immediately re-grab it -- used when auto-healing a stalled or
 * errored download, but not for a plain user-initiated cancel.
 */
export async function cancelRadarrDownload(
  radarrId: number,
  { blocklist = false, unmonitor = false }: { blocklist?: boolean; unmonitor?: boolean } = {}
): Promise<boolean> {
  if (!isRadarrConfigured()) return false;
  try {
    const queue = await radarrFetch<{ records: { id: number; movieId: number }[] }>(`/api/v3/queue`);
    const entry = queue.records.find((r) => r.movieId === radarrId);
    if (entry) {
      await radarrFetch(
        `/api/v3/queue/${entry.id}?removeFromClient=true&blocklist=${blocklist}`,
        { method: "DELETE" }
      );
    }
    // A user-initiated cancel must also stop Radarr wanting the movie,
    // otherwise it stays monitored and the idle-title healer re-grabs it.
    // The healer's own cancels deliberately stay monitored so they re-search.
    if (unmonitor) await setRadarrMovieMonitored(radarrId, false);
    // Idempotent: nothing queued means the movie already isn't downloading,
    // which is exactly what a cancel is asking for. Reporting failure there
    // surfaced a bogus "couldn't cancel" for downloads that had just
    // finished or were never grabbed.
    return true;
  } catch (err) {
    console.error(`[radarr] cancelRadarrDownload failed for ${radarrId}:`, err);
    return false;
  }
}

/** Flips a movie's monitored flag -- Radarr's own notion of "do I still want this". */
export async function setRadarrMovieMonitored(
  radarrId: number,
  monitored: boolean
): Promise<void> {
  if (!isRadarrConfigured()) return;
  const movie = await radarrFetch<Record<string, unknown>>(`/api/v3/movie/${radarrId}`);
  await radarrFetch(`/api/v3/movie/${radarrId}`, {
    method: "PUT",
    body: JSON.stringify({ ...movie, monitored }),
  });
}

/**
 * Drops blocklist entries older than `maxAgeHours`.
 *
 * Blocklisting is permanent, but most of what gets blocklisted here stalled
 * for reasons that had nothing to do with the release -- a VPN reconnect, a
 * momentary peer drought. Left alone, the healthiest releases accumulate on
 * the blocklist and searches degrade to worse-seeded ones over time
 * (Severance S01E01's 104-seeder release was blocked while a 12-seeder one
 * downloaded). Expiring entries lets a good release become eligible again
 * once whatever was actually wrong has passed.
 */
export async function expireRadarrBlocklist(maxAgeHours: number): Promise<number> {
  if (!isRadarrConfigured()) return 0;
  return expireBlocklist(radarrFetch, maxAgeHours, "radarr");
}

type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function expireBlocklist(
  fetcher: Fetcher,
  maxAgeHours: number,
  label: string
): Promise<number> {
  try {
    const list = await fetcher<{ records: { id: number; date?: string }[] }>(
      `/api/v3/blocklist?pageSize=200`
    );
    const cutoff = Date.now() - maxAgeHours * 3600_000;
    const stale = list.records
      .filter((r) => !r.date || Date.parse(r.date) < cutoff)
      .map((r) => r.id);
    if (stale.length === 0) return 0;
    await fetcher(`/api/v3/blocklist/bulk`, {
      method: "DELETE",
      body: JSON.stringify({ ids: stale }),
    });
    console.log(`[healer] expired ${stale.length} ${label} blocklist entries`);
    return stale.length;
  } catch (err) {
    console.error(`[${label}] expireBlocklist failed:`, err);
    return 0;
  }
}

export type IdleWantedMovie = { externalId: number; title: string };

/**
 * Movies Radarr still wants but has nothing in flight for: monitored, no
 * file, and absent from the queue. This is the state a title lands in when a
 * search finds nothing, or when a grab is cleared without a new one starting
 * -- the Download button sits on "searching" forever with no search actually
 * running, which is exactly what it looked like for Grizzly Man.
 */
export async function getIdleWantedMovies(): Promise<IdleWantedMovie[]> {
  if (!isRadarrConfigured()) return [];
  try {
    const [movies, queue] = await Promise.all([
      radarrFetch<{ id: number; title: string; hasFile: boolean; monitored: boolean }[]>(
        "/api/v3/movie"
      ),
      radarrFetch<{ records: { movieId: number }[] }>("/api/v3/queue"),
    ]);
    const queued = new Set(queue.records.map((r) => r.movieId));
    return movies
      .filter((m) => m.monitored && !m.hasFile && !queued.has(m.id))
      .map((m) => ({ externalId: m.id, title: m.title }));
  } catch (err) {
    console.error("[radarr] getIdleWantedMovies failed:", err);
    return [];
  }
}

/** Kicks off a fresh release search for a movie already in Radarr. */
export async function searchRadarrMovie(radarrId: number): Promise<void> {
  if (!isRadarrConfigured()) return;
  await radarrFetch(`/api/v3/command`, {
    method: "POST",
    body: JSON.stringify({ name: "MoviesSearch", movieIds: [radarrId] }),
  });
}

export type QueueHealth = {
  /** Radarr movieId / Sonarr seriesId. */
  externalId: number;
  title: string;
  /** Radarr/Sonarr's own diagnosis, e.g. "The download is stalled with no connections". */
  errorMessage: string | null;
  /** How long this entry has been sitting in the queue. */
  ageMinutes: number;
  hasProgress: boolean;
};

function toQueueHealth(r: {
  title: string;
  size: number;
  sizeleft: number;
  added?: string;
  errorMessage?: string;
  status?: string;
}, externalId: number): QueueHealth {
  const added = r.added ? Date.parse(r.added) : Date.now();
  return {
    externalId,
    title: r.title,
    errorMessage: r.errorMessage ?? (r.status === "warning" || r.status === "failed" ? r.status : null),
    ageMinutes: (Date.now() - added) / 60000,
    hasProgress: r.size > 0 && r.sizeleft < r.size,
  };
}

/** Health snapshot of every entry in Radarr's queue, for the stall auto-healer. */
export async function getRadarrQueueHealth(): Promise<QueueHealth[]> {
  if (!isRadarrConfigured()) return [];
  try {
    const queue = await radarrFetch<{
      records: {
        movieId: number;
        title: string;
        size: number;
        sizeleft: number;
        added?: string;
        errorMessage?: string;
        status?: string;
      }[];
    }>(`/api/v3/queue`);
    return queue.records.map((r) => toQueueHealth(r, r.movieId));
  } catch (err) {
    console.error("[radarr] getRadarrQueueHealth failed:", err);
    return [];
  }
}

/**
 * Torrent infohashes Radarr grabbed for this movie.
 *
 * Radarr forgets a torrent once it's imported, so this is the only way back
 * to the thing still seeding in the download client after a delete.
 */
export async function getRadarrDownloadIds(radarrId: number): Promise<string[]> {
  if (!isRadarrConfigured()) return [];
  try {
    // This endpoint returns a bare array, unlike the paged /api/v3/history.
    const history = await radarrFetch<{ eventType?: string; downloadId?: string }[]>(
      `/api/v3/history/movie?movieId=${radarrId}`
    );
    const hashes = new Set<string>();
    for (const r of history ?? []) {
      if (r.downloadId && (r.eventType === "downloadFolderImported" || r.eventType === "grabbed")) {
        hashes.add(r.downloadId);
      }
    }
    return Array.from(hashes);
  } catch (err) {
    console.error(`[radarr] getRadarrDownloadIds failed for ${radarrId}:`, err);
    return [];
  }
}

/** Removes a movie (and its downloaded file, if any) from Radarr entirely. */
export async function deleteRadarrMovie(radarrId: number): Promise<boolean> {
  if (!isRadarrConfigured()) return false;
  try {
    // Gather torrent hashes before the delete wipes the history trail.
    const downloadIds = await getRadarrDownloadIds(radarrId);

    await radarrFetch(`/api/v3/movie/${radarrId}?deleteFiles=true&addImportExclusion=false`, {
      method: "DELETE",
    });
    // Radarr stops tracking a torrent once imported, so without this the
    // movie vanishes from Streamy but keeps seeding in qBittorrent.
    if (downloadIds.length > 0) await deleteTorrents(downloadIds);
    return true;
  } catch (err) {
    console.error(`[radarr] deleteRadarrMovie failed for ${radarrId}:`, err);
    return false;
  }
}

export type RadarrRequestResult =
  | { ok: true; radarrId: number; status: MediaRequestStatus }
  | { ok: false; error: string };

/**
 * Looks up a movie by TMDB id and adds it to Radarr, triggering a search.
 * If it's already in Radarr (e.g. added directly in Radarr's own UI, or a
 * prior request that Streamy lost track of), skips straight to reporting
 * its real current status instead of erroring on Radarr's duplicate-add
 * rejection.
 */
export async function requestMovie(tmdbId: string): Promise<RadarrRequestResult> {
  if (!isRadarrConfigured()) return { ok: false, error: "Radarr is not configured" };

  try {
    const existing = await radarrFetch<{ id: number; hasFile: boolean }[]>(
      `/api/v3/movie?tmdbId=${tmdbId}`
    );
    if (existing[0]) {
      const status = await resolveRadarrStatus(existing[0]);
      if (status === "requested") {
        // Already in Radarr but neither downloading nor available -- e.g. a
        // prior download was cancelled. Cancelling unmonitors the movie, and
        // Radarr won't grab anything it isn't monitoring, so re-monitor
        // before searching or the request would quietly do nothing.
        await setRadarrMovieMonitored(existing[0].id, true);
        await radarrFetch(`/api/v3/command`, {
          method: "POST",
          body: JSON.stringify({ name: "MoviesSearch", movieIds: [existing[0].id] }),
        });
      }
      return { ok: true, radarrId: existing[0].id, status };
    }

    const lookup = await radarrFetch<Record<string, unknown>[]>(
      `/api/v3/movie/lookup?term=tmdb:${tmdbId}`
    );
    const match = lookup[0];
    if (!match) return { ok: false, error: "Movie not found via Radarr lookup" };

    const created = await radarrFetch<{ id: number }>(`/api/v3/movie`, {
      method: "POST",
      body: JSON.stringify({
        ...match,
        tmdbId: Number(tmdbId),
        qualityProfileId: Number(RADARR_QUALITY_PROFILE_ID),
        rootFolderPath: RADARR_ROOT_FOLDER,
        monitored: true,
        addOptions: { searchForMovie: true },
      }),
    });
    return { ok: true, radarrId: created.id, status: "requested" };
  } catch (err) {
    console.error(`[radarr] requestMovie failed for tmdbId ${tmdbId}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Radarr error" };
  }
}
