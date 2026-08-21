/**
 * Sonarr API client (server-side only). Set SONARR_URL/SONARR_API_KEY/
 * SONARR_ROOT_FOLDER/SONARR_QUALITY_PROFILE_ID in env to enable.
 * Sonarr is keyed by TVDB id, not TMDB — requestShow() resolves the TVDB id
 * via TMDB's own external_ids endpoint first, so this is still deterministic
 * ID matching, never fuzzy title search.
 */

import { getTvExternalIds } from "./tmdb";

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
  return res.json();
}

export type SonarrRequestResult =
  | { ok: true; sonarrId: number; tvdbId: number }
  | { ok: false; error: string };

/** Resolves TMDB id -> TVDB id, looks the show up in Sonarr, adds it, and triggers a search. */
export async function requestShow(tmdbId: string): Promise<SonarrRequestResult> {
  if (!isSonarrConfigured()) return { ok: false, error: "Sonarr is not configured" };

  try {
    const { tvdbId } = await getTvExternalIds(tmdbId);
    if (!tvdbId) return { ok: false, error: "No TVDB id found for this show on TMDB" };

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
        addOptions: { searchForMissingEpisodes: true },
        seasons,
      }),
    });
    return { ok: true, sonarrId: created.id, tvdbId };
  } catch (err) {
    console.error(`[sonarr] requestShow failed for tmdbId ${tmdbId}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Sonarr error" };
  }
}
