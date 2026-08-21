/**
 * Radarr API client (server-side only). Set RADARR_URL/RADARR_API_KEY/
 * RADARR_ROOT_FOLDER/RADARR_QUALITY_PROFILE_ID in env to enable.
 * Radarr is keyed natively by TMDB id, so requests are a direct ID lookup —
 * no title matching involved.
 */

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
  return res.json();
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
