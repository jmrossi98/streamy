/**
 * Picking a show's TVDB id out of Sonarr's `tmdb:<id>` lookup.
 *
 * Sonarr is keyed by TVDB id. TMDB's external_ids is asked first, but new
 * streaming shows often have no TVDB link on TMDB yet -- The Rotten Files
 * with Stephanie Soo (TMDB 320936, 2026-11) had none, so every request for it
 * failed at once. Sonarr's metadata server maps TMDB ids to TVDB itself, so
 * its lookup fills the gap. Only a hit carrying the same TMDB id counts: this
 * stays an id match, never a title search.
 */

export type SonarrLookupHit = { tmdbId?: number | null; tvdbId?: number | null };

export function tvdbIdFromLookup(hits: readonly SonarrLookupHit[], tmdbId: string): number | null {
  const want = Number(tmdbId);
  if (!Number.isInteger(want) || want <= 0) return null;
  const hit = hits.find((h) => h.tmdbId === want && typeof h.tvdbId === "number" && h.tvdbId > 0);
  return hit?.tvdbId ?? null;
}
