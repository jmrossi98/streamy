/**
 * Radarr API client (server-side only). Set RADARR_URL/RADARR_API_KEY/
 * RADARR_ROOT_FOLDER/RADARR_QUALITY_PROFILE_ID in env to enable.
 * Radarr is keyed natively by TMDB id, so requests are a direct ID lookup —
 * no title matching involved.
 */

import { pickDeepRelease, type DeepRelease } from "./deepSearchRules";
import { pickFastCopies, type FastCopyRelease } from "./fastCopyRules";
import { movieSearchesToCancel, type ArrCommand } from "./cancelRules";
import { deleteTorrents } from "./qbittorrent";
import { classifyBadRelease, type BadReleaseReason, type BlocklistRecord } from "./downloadHealthRules";
import { resolveQualityProfileId, type QualityTier } from "./qualityTier";
import { cached } from "./ttlCache";
import { protocolsFromHistory, type HistoryEvent } from "./historyProtocolRules";

const RADARR_URL = process.env.RADARR_URL?.replace(/\/$/, "");

/**
 * Page size for every Radarr/Sonarr queue read.
 *
 * The queue endpoint is paged and defaults to TEN records. Fourteen reads here
 * asked for it without a size, so each saw only the first ten downloads: with
 * the Sopranos batch queued, an episode on page two flipped between
 * "downloading 43%" and "Starting..." from one poll to the next, the healer
 * took page-two episodes for idle and searched them again, and cancel could
 * not find their queue entries. A test (queuePageSize.test.ts) keeps any
 * new read from going back to the default.
 */
export const QUEUE_PAGE_SIZE = 1000;
const RADARR_API_KEY = process.env.RADARR_API_KEY;
const RADARR_ROOT_FOLDER = process.env.RADARR_ROOT_FOLDER;
const RADARR_QUALITY_PROFILE_ID = process.env.RADARR_QUALITY_PROFILE_ID;
// Unset until a 4K profile is configured, in which case every tier resolves
// to the HD profile and nothing changes. See resolveQualityProfileId.
const RADARR_QUALITY_PROFILE_ID_4K = process.env.RADARR_QUALITY_PROFILE_ID_4K;

export function isRadarrConfigured(): boolean {
  return !!(
    RADARR_URL &&
    RADARR_API_KEY &&
    RADARR_ROOT_FOLDER &&
    RADARR_QUALITY_PROFILE_ID &&
    !Number.isNaN(Number(RADARR_QUALITY_PROFILE_ID))
  );
}

// Unbounded before this: a slow/hung Radarr call had no ceiling at all, so the
// request chain (and the client's fetch behind it, which has no timeout of
// its own either) could sit indefinitely with zero feedback -- exactly what
// "stuck on starting" for minutes looks like. 15s per call, so even a handful
// of sequential calls in one request flow stays close to a ~30s ceiling
// end-to-end, while failing visibly instead of hanging forever.
const ARR_FETCH_TIMEOUT_MS = 15_000;

async function radarrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RADARR_URL}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": RADARR_API_KEY!,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(ARR_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Radarr API error: ${res.status} ${body}`.trim());
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// "requested" (still actively searching) vs "noReleaseFound" (searched, came
// up empty) look identical to a viewer without this distinction -- both were
// shown as an indefinite spinner, so a title that will never come in without
// a config change read exactly like one about to succeed any second. Radarr
// exposes lastSearchTime on the movie itself; once that's old enough for a
// normal search-to-grab round trip to have finished and nothing changed,
// there's nothing left actually happening.
export type MediaRequestStatus = "requested" | "noReleaseFound" | "downloading" | "available";

// 5 minutes, not 3 -- confirmed live that a single search command against
// the full indexer set can legitimately take ~90s, and the healer (see
// downloadHealer.ts) re-searches idle titles on its own roughly every couple
// of minutes. 3 minutes was tight enough to flip to "no release found" right
// before that natural retry landed, reading as flapping rather than one
// continuous search.
const SEARCH_GRACE_MS = 5 * 60 * 1000;

export function isSearchStale(lastSearchTime?: string | null): boolean {
  if (!lastSearchTime) return false;
  return Date.now() - Date.parse(lastSearchTime) > SEARCH_GRACE_MS;
}

/**
 * Download percent from a queue entry's size/sizeleft.
 *
 * Returns null rather than 0 while size is 0 -- that's a torrent whose
 * metadata hasn't resolved yet, and reporting it as 0% wrongly implies the
 * transfer has started. Callers render the null case as "starting" instead.
 */
export function computeProgress(size: number, sizeleft: number): number | null {
  if (!size || size <= 0) return null;
  const done = size - sizeleft;
  const pct = Math.round((done / size) * 100);
  return Math.min(100, Math.max(0, pct));
}

/** hasFile means Radarr already imported a file; otherwise check the active queue. */
async function resolveRadarrStatus(
  movie: { id: number; hasFile: boolean; lastSearchTime?: string | null }
): Promise<MediaRequestStatus> {
  if (movie.hasFile) return "available";
  const queue = await radarrFetch<{ records: { movieId: number }[] }>(`/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`);
  if (queue.records.some((r) => r.movieId === movie.id)) return "downloading";
  return isSearchStale(movie.lastSearchTime) ? "noReleaseFound" : "requested";
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
    const movies = await radarrFetch<
      { id: number; hasFile: boolean; monitored: boolean; lastSearchTime?: string | null }[]
    >(`/api/v3/movie?tmdbId=${tmdbId}`);
    const movie = movies[0];
    if (!movie) return null;
    if (movie.hasFile) return { status: "available", radarrId: movie.id };

    const queue = await radarrFetch<{ records: { movieId: number }[] }>(`/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`);
    if (queue.records.some((r) => r.movieId === movie.id)) {
      return { status: "downloading", radarrId: movie.id };
    }
    // In Radarr but idle: only "requested"/"noReleaseFound" if it's actually
    // still wanted.
    if (!movie.monitored) return null;
    return {
      status: isSearchStale(movie.lastSearchTime) ? "noReleaseFound" : "requested",
      radarrId: movie.id,
    };
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
    const movie = await radarrFetch<{
      id: number;
      hasFile: boolean;
      monitored: boolean;
      lastSearchTime?: string | null;
    }>(`/api/v3/movie/${radarrId}`);
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
      `/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`
    );
    const entry = queue.records.find((r) => r.movieId === radarrId);
    if (!entry || !entry.size) return null;
    return Math.round(((entry.size - entry.sizeleft) / entry.size) * 100);
  } catch (err) {
    console.error("[radarr] getRadarrDownloadProgress failed:", err);
    return null;
  }
}

export type RadarrQueueDetail = {
  progress: number | null;
  importing: boolean;
  unsafe: BadReleaseReason | null;
};

/**
 * What one movie's queue entry is doing right now. Replaces asking only for a
 * percent: a percent of 100 could mean "moving the file into the library" or
 * "a fake that will never import", and the button needs to say which.
 */
export async function getRadarrQueueDetail(radarrId: number): Promise<RadarrQueueDetail | null> {
  if (!isRadarrConfigured()) return null;
  try {
    const queue = await radarrFetch<{
      records: {
        movieId: number;
        size: number;
        sizeleft: number;
        trackedDownloadState?: string;
        statusMessages?: { messages?: string[] }[];
      }[];
    }>(`/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`);
    const entry = queue.records.find((r) => r.movieId === radarrId);
    if (!entry) return null;
    const unsafe = classifyBadRelease(entry);
    return {
      progress: computeProgress(entry.size, entry.sizeleft),
      importing: !unsafe && IMPORTING_STATES.has(entry.trackedDownloadState ?? ""),
      unsafe,
    };
  } catch (err) {
    console.error("[radarr] getRadarrQueueDetail failed:", err);
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
/** Normalizes Radarr/Sonarr's own `protocol` field ("usenet" | "torrent") into
 *  a type the UI can render without trusting arbitrary API string values --
 *  anything else (a future protocol, an unexpected casing) reports as
 *  "unknown" rather than silently mis-labeling it as one of the two. */
export type DownloadProtocol = "usenet" | "torrent" | "unknown";

// The live queue endpoint (`/api/v3/queue`) reports protocol as the word
// itself ("usenet"/"torrent"); the history endpoint (`/api/v3/history`)
// reports the same underlying value as Radarr/Sonarr's internal numeric
// enum instead ("1"/"2") -- confirmed by cross-referencing real grabbed
// events against their own known download client (SABnzbd vs qBittorrent)
// and indexer (NZBgeek vs a torrent tracker), which agreed on every row
// checked. Both call sites feed this one function rather than each
// hand-rolling their own mapping.
export function normalizeProtocol(raw: string | undefined): DownloadProtocol {
  const p = raw?.toLowerCase();
  if (p === "usenet" || p === "1") return "usenet";
  if (p === "torrent" || p === "2") return "torrent";
  return "unknown";
}

export type ActiveDownload = {
  queueId: number;
  /** When the grab entered the download client's queue. */
  startedAt?: string | null;
  externalId: number;
  title: string;
  progress: number | null;
  protocol: DownloadProtocol;
  /** Total release size in bytes -- the queue's own `size`, present even
   *  before anything has downloaded (unlike sizeleft, which only shrinks). */
  sizeBytes: number | null;
  /** Sonarr only -- undefined for a movie. Threaded through so the UI can key
   *  a downloading episode by something that survives the queue entry itself
   *  disappearing on import, instead of only by queueId (which does not). */
  episodeId?: number;
  /**
   * The transfer itself is done (sizeleft is 0, progress reads 100%) but
   * Radarr/Sonarr hasn't finished moving the file into the library yet --
   * copying/hardlinking and renaming a multi-gigabyte file is not instant,
   * and the queue entry survives until that finishes. Without this the
   * panel had nothing to show for that window but a static 100% bar next to
   * a label that still said "downloading", reported live as a torrent that
   * "leapt to 100% then got stuck" -- it wasn't stuck, it was importing, and
   * there was no way to tell the two apart.
   */
  importing: boolean;
  /** Finished downloading but the payload is something that must never be
   *  imported (an executable posing as a movie). Set only until the healer
   *  removes it -- a window worth showing rather than leaving at "100%". */
  unsafe?: BadReleaseReason;
};

/**
 * `trackedDownloadState` values from Radarr/Sonarr's queue that mean the
 * transfer is done and it's now copying the file into the library, not
 * still moving data from the download client.
 */
export const IMPORTING_STATES = new Set(["importPending", "importing"]);

/** Every movie currently in Radarr's active download queue, with live progress. */
export async function getRadarrActiveDownloads(): Promise<ActiveDownload[]> {
  if (!isRadarrConfigured()) return [];
  try {
    const queue = await radarrFetch<{
      records: {
        id: number;
        movieId: number;
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
        // When it was grabbed -- the Sonarr side always set this; without it
        // an in-flight movie had no date and sorted below the whole library.
        startedAt: r.added ?? null,
        externalId: r.movieId,
        title: r.title,
        progress: computeProgress(r.size, r.sizeleft),
        protocol: normalizeProtocol(r.protocol),
        sizeBytes: r.size > 0 ? r.size : null,
        // An unsafe entry is not "importing" -- it never will be.
        importing: !unsafe && IMPORTING_STATES.has(r.trackedDownloadState ?? ""),
        ...(unsafe ? { unsafe } : {}),
      };
    });
  } catch (err) {
    console.error("[radarr] getRadarrActiveDownloads failed:", err);
    return [];
  }
}

/**
 * Cancels one specific queued download.
 *
 * `unmonitor` is a person's cancel: the movie stops being wanted first, so
 * Radarr does not simply grab it again. The healer leaves it off, because it
 * is replacing a bad download and wants the retry.
 */
export async function cancelRadarrQueueItem(
  queueId: number,
  { blocklist = false, unmonitor = false }: { blocklist?: boolean; unmonitor?: boolean } = {}
): Promise<boolean> {
  if (!isRadarrConfigured()) return false;
  try {
    if (unmonitor) {
      try {
        const queue = await radarrFetch<{ records: { id: number; movieId?: number }[] }>(
          `/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`
        );
        const movieId = queue.records.find((r) => r.id === queueId)?.movieId;
        if (movieId != null) await stopWantingMovie(movieId);
      } catch (err) {
        console.error(`[radarr] could not unmonitor the movie for queue ${queueId}:`, err);
      }
    }
    await radarrFetch(`/api/v3/queue/${queueId}?removeFromClient=true&blocklist=${blocklist}`, {
      method: "DELETE",
    });
    return true;
  } catch (err) {
    console.error(`[radarr] cancelRadarrQueueItem failed for ${queueId}:`, err);
    return false;
  }
}

export type CompletedDownload = {
  id: number;
  title: string;
  protocol?: DownloadProtocol;
  sizeBytes: number | null;
  /** When the file landed in the library, for "recently added" ordering. */
  addedAt: string | null;
};

/**
 * Which protocol actually delivered each already-completed movie, keyed by
 * Radarr's own movie id. The completed list itself (`/api/v3/movie`) has no
 * protocol field -- that only exists on a queue entry, which stops existing
 * once the download finishes, which is exactly why the badge used to vanish
 * the moment a download completed. History keeps a permanent record of it
 * (the `grabbed` event, which is what carries `protocol` -- confirmed
 * against real data), so one bulk history fetch here recovers it after the
 * fact instead of needing a live queue entry. Keeps the most recent grab per
 * movie, in case of a re-grab/repack.
 */
export async function getRadarrCompletedProtocols(): Promise<Map<number, DownloadProtocol>> {
  const result = new Map<number, DownloadProtocol>();
  if (!isRadarrConfigured()) return result;
  try {
    const history = await radarrFetch<{
      records: { movieId?: number; date: string; data?: { protocol?: string } }[];
    }>("/api/v3/history?pageSize=1000&eventType=1&sortKey=date&sortDirection=descending");
    for (const r of history.records) {
      if (r.movieId == null || result.has(r.movieId)) continue; // newest first -- first hit per movie wins
      result.set(r.movieId, normalizeProtocol(r.data?.protocol));
    }
  } catch (err) {
    console.error("[radarr] getRadarrCompletedProtocols failed:", err);
  }
  return result;
}

/** Basename of a path, minus its extension -- "Movie.2024.1080p.BluRay.mkv" -> "Movie.2024.1080p.BluRay".
 * Exported for the Sonarr side too -- same file-naming convention, same need. */
export function fileBaseName(relativePath: string): string {
  const base = relativePath.split(/[/\\]/).pop() ?? relativePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Every movie Radarr has fully downloaded, for the admin panel's completed
 * section. Shows the actual imported file's name (quality/source tags and
 * all) rather than Radarr's clean parsed movie title -- while a download is
 * active the panel shows the release name from the queue, and switching to
 * the tidied-up title the moment it finishes read as if the real filename
 * had been discarded on import. Falls back to the movie title only if a file
 * is somehow missing its own filename (movieFile without a relativePath).
 */
async function movieProtocol(movieId: number): Promise<DownloadProtocol | undefined> {
  try {
    const found = await cached(`radarr:movie-protocol:${movieId}`, 60 * 60_000, async () =>
      protocolsFromHistory(
        await radarrFetch<HistoryEvent[]>(`/api/v3/history/movie?movieId=${movieId}`),
        (e) => e.movieId
      )
    );
    return found.get(movieId);
  } catch (err) {
    console.error(`[radarr] movie history read failed for ${movieId}:`, err);
    return undefined;
  }
}

export async function getRadarrCompletedMovies(): Promise<CompletedDownload[]> {
  if (!isRadarrConfigured()) return [];
  try {
    const [movies, protocols] = await Promise.all([
      radarrFetch<
        {
          id: number;
          title: string;
          hasFile: boolean;
          movieFile?: { relativePath?: string; size?: number; dateAdded?: string };
        }[]
      >("/api/v3/movie"),
      getRadarrCompletedProtocols(),
    ]);
    // Movies grabbed before the global 1000-grab window: their own history.
    const older = await Promise.all(
      movies.filter((m) => m.hasFile && !protocols.has(m.id)).map(async (m) => [m.id, await movieProtocol(m.id)] as const)
    );
    const olderById = new Map(older);
    return movies
      .filter((m) => m.hasFile)
      .map((m) => ({
        id: m.id,
        title: m.movieFile?.relativePath ? fileBaseName(m.movieFile.relativePath) : m.title,
        protocol: protocols.get(m.id) ?? olderById.get(m.id),
        sizeBytes: m.movieFile?.size ?? null,
        addedAt: m.movieFile?.dateAdded ?? null,
      }));
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
    const emptyQueue = async () => {
      const queue = await radarrFetch<{ records: { id: number; movieId: number }[] }>(
        `/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`
      );
      // Every entry, not the first: a movie can have a stuck and a fresh one.
      for (const entry of queue.records.filter((r) => r.movieId === radarrId)) {
        await radarrFetch(`/api/v3/queue/${entry.id}?removeFromClient=true&blocklist=${blocklist}`, {
          method: "DELETE",
        });
      }
    };
    // A user-initiated cancel must first stop Radarr wanting the movie --
    // otherwise it stays monitored and is grabbed again -- and stop a search
    // already running. The healer's own cancels deliberately stay monitored
    // so they re-search.
    if (unmonitor) await stopWantingMovie(radarrId);
    await emptyQueue();
    if (unmonitor) {
      // A grab that was already in flight lands a moment after the first pass.
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      await emptyQueue();
    }
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

/** Unmonitors a movie and cancels any live search for it. Best-effort per step. */
async function stopWantingMovie(radarrId: number): Promise<void> {
  try {
    await setRadarrMovieMonitored(radarrId, false);
  } catch (err) {
    console.error(`[radarr] could not unmonitor movie ${radarrId}:`, err);
  }
  try {
    const commands = await radarrFetch<ArrCommand[]>("/api/v3/command");
    for (const id of movieSearchesToCancel(commands, radarrId)) {
      await radarrFetch(`/api/v3/command/${id}`, { method: "DELETE" }).catch(() => undefined);
    }
  } catch (err) {
    console.error(`[radarr] could not stop running searches for movie ${radarrId}:`, err);
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
export async function expireRadarrBlocklist(
  maxAgeHours: number,
  keep?: (record: BlocklistRecord) => boolean,
  releaseNow?: (record: BlocklistRecord) => boolean
): Promise<number> {
  if (!isRadarrConfigured()) return 0;
  return expireBlocklist(radarrFetch, maxAgeHours, "radarr", keep, releaseNow);
}

type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function expireBlocklist(
  fetcher: Fetcher,
  maxAgeHours: number,
  label: string,
  // Entries that must outlive the TTL -- a release rejected as unsafe was never
  // "blocked by a transient stall", so letting it expire would just re-grab it.
  keep: (record: BlocklistRecord) => boolean = () => false,
  // Entries to unblock whatever their age -- releases that were only ever
  // blocked because a person cancelled them.
  releaseNow: (record: BlocklistRecord) => boolean = () => false
): Promise<number> {
  try {
    const list = await fetcher<{ records: ({ id: number; date?: string } & BlocklistRecord)[] }>(
      `/api/v3/blocklist?pageSize=200`
    );
    const cutoff = Date.now() - maxAgeHours * 3600_000;
    const stale = list.records
      .filter((r) => !keep(r) && (releaseNow(r) || !r.date || Date.parse(r.date) < cutoff))
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
      radarrFetch<{ records: { movieId: number }[] }>(`/api/v3/queue?pageSize=${QUEUE_PAGE_SIZE}`),
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

/** A deep search asks every indexer, slow ones included; allow for it. */
const DEEP_SEARCH_TIMEOUT_MS = 180_000;
const deepSearching = new Set<number>();

/**
 * The second-chance search for a movie the ordinary search found nothing for
 * -- see deepSearchRules.ts. Returns the title grabbed, or null. One at a time
 * per movie: it takes a minute or more, and the healer comes round faster.
 */
export async function deepSearchRadarrMovie(radarrId: number): Promise<string | null> {
  if (!isRadarrConfigured() || deepSearching.has(radarrId)) return null;
  deepSearching.add(radarrId);
  try {
    const releases = await radarrFetch<DeepRelease[]>(`/api/v3/release?movieId=${radarrId}`, {
      signal: AbortSignal.timeout(DEEP_SEARCH_TIMEOUT_MS),
    });
    const pick = pickDeepRelease(releases);
    if (!pick) return null;
    // Grabbing by guid is Radarr's manual grab: it takes the release as chosen.
    await radarrFetch(`/api/v3/release`, {
      method: "POST",
      body: JSON.stringify({ guid: pick.guid, indexerId: pick.indexerId }),
      signal: AbortSignal.timeout(60_000),
    });
    return pick.title;
  } finally {
    deepSearching.delete(radarrId);
  }
}

/**
 * Grabs a usenet copy for a movie whose only download is a slow torrent --
 * see fastCopyRules.ts. Returns the release grabbed, or null. Shares the deep
 * search's one-at-a-time guard: both run the same slow release search.
 */
export async function fastCopyRadarrMovie(radarrId: number, alreadyTried: ReadonlySet<string>): Promise<string | null> {
  if (!isRadarrConfigured() || deepSearching.has(radarrId)) return null;
  deepSearching.add(radarrId);
  try {
    const releases = await radarrFetch<FastCopyRelease[]>(`/api/v3/release?movieId=${radarrId}`, {
      signal: AbortSignal.timeout(DEEP_SEARCH_TIMEOUT_MS),
    });
    const pick = pickFastCopies(releases, alreadyTried)[0];
    if (!pick) return null;
    await radarrFetch(`/api/v3/release`, {
      method: "POST",
      body: JSON.stringify({ guid: pick.guid, indexerId: pick.indexerId }),
      signal: AbortSignal.timeout(60_000),
    });
    return pick.title;
  } finally {
    deepSearching.delete(radarrId);
  }
}

export type QueueHealth = {
  /** This queue entry itself -- what removing one specific download targets. */
  queueId: number;
  /** Radarr movieId / Sonarr seriesId. */
  externalId: number;
  /** Sonarr only: the episode this entry is for, so a re-search can be scoped to it. */
  episodeId?: number;
  /** The download client's id for it (a torrent's info hash). */
  downloadId: string | null;
  /** Set when the finished payload is something that must be discarded. */
  unsafe: BadReleaseReason | null;
  title: string;
  /** Radarr/Sonarr's own diagnosis, e.g. "The download is stalled with no connections". */
  errorMessage: string | null;
  /** How long this entry has been sitting in the queue. */
  ageMinutes: number;
  hasProgress: boolean;
  /** Queue status: "downloading", "queued", "completed", ... */
  clientStatus: string | null;
  /** Import pipeline state, e.g. "importPending", and its "ok"/"warning"/"error". */
  trackedDownloadState: string | null;
  trackedDownloadStatus: string | null;
  /** Radarr/Sonarr's own words for an import problem, for the log. */
  importProblem: string | null;
  /** The same, one message each, for rules that judge them individually. */
  statusMessages: string[];
  /** "usenet" or "torrent". */
  protocol: string | null;
  /** The episode/movie already has a file, so this download is an upgrade. */
  isUpgrade: boolean;
};

export function toQueueHealth(r: {
  id: number;
  title: string;
  size: number;
  sizeleft: number;
  added?: string;
  errorMessage?: string;
  status?: string;
  downloadId?: string;
  episodeId?: number;
  statusMessages?: { messages?: string[] }[];
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  protocol?: string;
  /** Sonarr's episodeHasFile, or Radarr's movie.hasFile. */
  hasFile?: boolean;
}, externalId: number): QueueHealth {
  const added = r.added ? Date.parse(r.added) : Date.now();
  const statusMessages = (r.statusMessages ?? []).flatMap((m) => m.messages ?? []);
  return {
    queueId: r.id,
    episodeId: r.episodeId,
    downloadId: r.downloadId ?? null,
    unsafe: classifyBadRelease(r),
    externalId,
    title: r.title,
    errorMessage: r.errorMessage ?? (r.status === "warning" || r.status === "failed" ? r.status : null),
    ageMinutes: (Date.now() - added) / 60000,
    hasProgress: r.size > 0 && r.sizeleft < r.size,
    clientStatus: r.status ?? null,
    trackedDownloadState: r.trackedDownloadState ?? null,
    trackedDownloadStatus: r.trackedDownloadStatus ?? null,
    importProblem: statusMessages.join("; ") || null,
    statusMessages,
    protocol: r.protocol ?? null,
    isUpgrade: !!r.hasFile,
  };
}

/** Health snapshot of every entry in Radarr's queue, for the stall auto-healer. */
export async function getRadarrQueueHealth(): Promise<QueueHealth[]> {
  if (!isRadarrConfigured()) return [];
  try {
    const queue = await radarrFetch<{
      records: {
        id: number;
        movieId: number;
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
        movie?: { hasFile?: boolean };
      }[];
    }>(`/api/v3/queue?pageSize=250&includeMovie=true`);
    return queue.records.map((r) => toQueueHealth({ ...r, hasFile: r.movie?.hasFile }, r.movieId));
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

export type RadarrHealthIssue = { source: string; message: string; type: "error" | "warning" };

/**
 * Radarr's own self-reported integration health -- indexers, download
 * clients, import paths, etc. This is how a *stale download-client password*
 * shows up: Streamy's own connectivity to Radarr can be perfectly fine while
 * Radarr's connection to qBittorrent is broken underneath it, and nothing
 * Streamy checks directly would ever notice. Radarr already tracks exactly
 * this and exposes it here -- surfacing it is cheaper and more honest than
 * re-deriving the same checks ourselves.
 */
export async function getRadarrHealthIssues(): Promise<RadarrHealthIssue[]> {
  if (!isRadarrConfigured()) return [];
  try {
    const issues = await radarrFetch<{ source: string; message: string; type: string }[]>(
      "/api/v3/health"
    );
    return issues
      .filter((i) => i.type === "error" || i.type === "warning")
      .map((i) => ({ source: i.source, message: i.message, type: i.type as "error" | "warning" }));
  } catch (err) {
    console.error("[radarr] getRadarrHealthIssues failed:", err);
    return [];
  }
}

// Same detection the mediabox's own auto-import-safe.py cron uses to decide
// what it can safely confirm on its own (see mediabox-infra) -- a release
// finished downloading, but the app's parser couldn't self-confirm which
// movie/episode it is from the filename alone, so it's sitting in the queue
// waiting for a human. That cron auto-resolves the unambiguous case every 15
// minutes; what survives here is specifically the harder case it also
// declined to touch (multiple candidates, a mismatched title, a real quality
// rejection) -- exactly the kind of thing that otherwise needs a viewer to
// notice a title stuck at 100% and ask about it before anyone finds out.
//
// Exported (and kept pure) so this specific matching logic -- shared by both
// Radarr's and Sonarr's version of this check -- has a real test, the same
// way mergeCombinedCredits in tmdb.ts does for its own easy-to-silently-break
// logic.
export type QueueItemForImportCheck = {
  trackedDownloadState?: string;
  status?: string;
  sizeleft?: number;
  statusMessages?: { messages?: string[] }[];
};

const CONFIDENCE_BLOCK_PATTERN = /matched to \w+ by ID.*Manual Import required/i;

export function isConfidenceBlockedQueueItem(item: QueueItemForImportCheck): boolean {
  if (item.trackedDownloadState !== "importBlocked") return false;
  if (item.status !== "completed" || (item.sizeleft ?? 1) !== 0) return false;
  const messages = (item.statusMessages ?? []).flatMap((sm) => sm.messages ?? []);
  return messages.some((m) => CONFIDENCE_BLOCK_PATTERN.test(m));
}

/** Titles genuinely stuck on a Manual Import confirmation only a person can make. */
export async function getRadarrStuckImports(): Promise<string[]> {
  if (!isRadarrConfigured()) return [];
  try {
    const queue = await radarrFetch<{
      records: (QueueItemForImportCheck & { title: string })[];
    }>("/api/v3/queue?pageSize=250");
    return queue.records.filter(isConfidenceBlockedQueueItem).map((r) => r.title);
  } catch (err) {
    console.error("[radarr] getRadarrStuckImports failed:", err);
    return [];
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
export async function requestMovie(
  tmdbId: string,
  tier: QualityTier = "hd"
): Promise<RadarrRequestResult> {
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
        qualityProfileId: resolveQualityProfileId(
          tier,
          RADARR_QUALITY_PROFILE_ID,
          RADARR_QUALITY_PROFILE_ID_4K
        ),
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

/**
 * Why a grab went to torrent rather than usenet, or the other way.
 *
 * "Torrent wins every time" is a reasonable thing to notice and an unreasonable
 * thing to have to reverse-engineer. Radarr's choice is the product of three
 * separate settings across two apps plus the live health of each indexer, none
 * of which is visible in one place -- so this assembles it.
 *
 * The case that motivated it: usenet was the *preferred* protocol the whole
 * time, with a 30-minute handicap applied to torrents, and torrents still won
 * every single grab. Not because the preference was wrong, but because no
 * usenet release could be fetched at all. A preference you cannot act on looks
 * identical to a preference you do not have.
 */
export type ProtocolPreference = {
  preferred: "usenet" | "torrent" | "unknown";
  usenetDelayMinutes: number;
  torrentDelayMinutes: number;
  usenetEnabled: boolean;
  torrentEnabled: boolean;
};

export type GrabCounts = { usenet: number; torrent: number };

export type DownloadRouting = {
  preference: ProtocolPreference | null;
  /** Grabs in the recent history window, split by protocol. */
  recentGrabs: GrabCounts;
  /** Indexers Radarr currently has enabled, by protocol. */
  indexers: GrabCounts;
  /** Indexers Radarr has disabled for failures right now. */
  failingIndexerIds: number[];
};

/** Just enough of an *arr client for the routing read. */
type ArrFetch = <T>(path: string) => Promise<T>;

/**
 * Reads protocol routing from any *arr app.
 *
 * Shared because Radarr and Sonarr expose the same delay-profile, history and
 * indexer endpoints, and the question -- "why does this protocol keep winning"
 * -- is identical for films and episodes.
 */
export async function readDownloadRouting(
  fetchJson: ArrFetch,
  app: string
): Promise<DownloadRouting | null> {
  try {
    // indexerstatus is fetched separately and allowed to fail. Neither Radarr
    // nor Sonarr has it on /api/v3 -- both answer 404, measured 2026-09-26 --
    // and when it sat inside the Promise.all below, that one 404 rejected the
    // whole read and the panel reported "Radarr isn't reachable" while Radarr
    // was perfectly reachable and answering every other endpoint in 0.1s.
    const failingIndexerIds = fetchJson<{ indexerId: number }[]>("/api/v3/indexerstatus")
      .then((rows) => rows.map((r) => r.indexerId))
      .catch(() => [] as number[]);

    const [profiles, history, indexers, failing] = await Promise.all([
      fetchJson<
        {
          preferredProtocol?: number;
          usenetDelay?: number;
          torrentDelay?: number;
          enableUsenet?: boolean;
          enableTorrent?: boolean;
        }[]
      >("/api/v3/delayprofile"),
      fetchJson<{ records: { eventType: string; data?: { protocol?: string } }[] }>(
        "/api/v3/history?pageSize=50&sortKey=date&sortDirection=descending"
      ),
      fetchJson<{ protocol: string; enableAutomaticSearch: boolean }[]>("/api/v3/indexer"),
      failingIndexerIds,
    ]);

    // The default profile is the one with no tags; both apps order it first.
    const p = profiles[0];
    const preference: ProtocolPreference | null = p
      ? {
          // Encoded as 1=usenet, 2=torrent in the API even though the UI
          // shows words.
          preferred:
            p.preferredProtocol === 1 ? "usenet" : p.preferredProtocol === 2 ? "torrent" : "unknown",
          usenetDelayMinutes: p.usenetDelay ?? 0,
          torrentDelayMinutes: p.torrentDelay ?? 0,
          usenetEnabled: p.enableUsenet !== false,
          torrentEnabled: p.enableTorrent !== false,
        }
      : null;

    const recentGrabs: GrabCounts = { usenet: 0, torrent: 0 };
    for (const r of history.records) {
      if (r.eventType !== "grabbed") continue;
      // Written as the string "usenet"/"torrent" in history data, but the
      // numeric enum has also been used; accept both rather than silently
      // counting nothing.
      const proto = String(r.data?.protocol ?? "").toLowerCase();
      if (proto === "usenet" || proto === "1") recentGrabs.usenet += 1;
      else if (proto === "torrent" || proto === "2") recentGrabs.torrent += 1;
    }

    const counts: GrabCounts = { usenet: 0, torrent: 0 };
    for (const i of indexers) {
      if (!i.enableAutomaticSearch) continue;
      if (i.protocol === "usenet") counts.usenet += 1;
      else if (i.protocol === "torrent") counts.torrent += 1;
    }

    return { preference, recentGrabs, indexers: counts, failingIndexerIds: failing };
  } catch (err) {
    console.error(`[${app}] download routing read failed:`, err);
    return null;
  }
}

export async function getDownloadRouting(): Promise<DownloadRouting | null> {
  if (!isRadarrConfigured()) return null;
  return readDownloadRouting((path) => radarrFetch(path), "radarr");
}