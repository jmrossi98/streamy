/**
 * Sonarr API client (server-side only). Set SONARR_URL/SONARR_API_KEY/
 * SONARR_ROOT_FOLDER/SONARR_QUALITY_PROFILE_ID in env to enable.
 * Sonarr is keyed by TVDB id, not TMDB — requestShow() resolves the TVDB id
 * via TMDB's own external_ids endpoint first, so this is still deterministic
 * ID matching, never fuzzy title search.
 */

import { getTvExternalIds } from "./tmdb";
import type { MediaRequestStatus, ActiveDownload } from "./radarr";

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
    const queue = await sonarrFetch<{ records: { title: string; size: number; sizeleft: number }[] }>(
      `/api/v3/queue`
    );
    return queue.records.map((r) => ({
      title: r.title,
      progress: r.size > 0 ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : null,
    }));
  } catch (err) {
    console.error("[sonarr] getSonarrActiveDownloads failed:", err);
    return [];
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
        addOptions: { searchForMissingEpisodes: true },
        seasons,
      }),
    });
    return { ok: true, sonarrId: created.id, tvdbId, status: "requested" };
  } catch (err) {
    console.error(`[sonarr] requestShow failed for tmdbId ${tmdbId}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Sonarr error" };
  }
}
