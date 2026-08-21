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

export type RadarrRequestResult =
  | { ok: true; radarrId: number }
  | { ok: false; error: string };

/** Looks up a movie by TMDB id, adds it to Radarr, and triggers a search. */
export async function requestMovie(tmdbId: string): Promise<RadarrRequestResult> {
  if (!isRadarrConfigured()) return { ok: false, error: "Radarr is not configured" };

  try {
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
    return { ok: true, radarrId: created.id };
  } catch (err) {
    console.error(`[radarr] requestMovie failed for tmdbId ${tmdbId}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Radarr error" };
  }
}
