/**
 * Jellyfin API client (server-side only). Set JELLYFIN_URL/JELLYFIN_API_KEY
 * in env to enable. Streamy streams directly from Jellyfin (which already
 * scans Radarr/Sonarr's output folders) rather than staging a copy in S3 --
 * titles become playable the moment Jellyfin finishes scanning them in,
 * with no separate upload step.
 */

const JELLYFIN_URL = process.env.JELLYFIN_URL?.replace(/\/$/, "");
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;

export function isJellyfinConfigured(): boolean {
  return !!(JELLYFIN_URL && JELLYFIN_API_KEY);
}

async function jellyfinFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${JELLYFIN_URL}${path}`, {
    headers: { "X-Emby-Token": JELLYFIN_API_KEY! },
  });
  if (!res.ok) {
    throw new Error(`Jellyfin API error: ${res.status}`);
  }
  return res.json();
}

function streamUrl(itemId: string): string {
  return `${JELLYFIN_URL}/Videos/${itemId}/stream?static=true&api_key=${JELLYFIN_API_KEY}`;
}

/** A movie's direct-play stream URL, found by its TMDB id. Null if not yet scanned into Jellyfin. */
export async function getJellyfinMovieUrl(tmdbId: string): Promise<string | null> {
  if (!isJellyfinConfigured()) return null;
  try {
    const result = await jellyfinFetch<{ Items: { Id: string }[] }>(
      `/Items?AnyProviderIdEquals=Tmdb.${tmdbId}&IncludeItemTypes=Movie&Recursive=true`
    );
    const item = result.Items[0];
    return item ? streamUrl(item.Id) : null;
  } catch (err) {
    console.error(`[jellyfin] getJellyfinMovieUrl failed for tmdbId ${tmdbId}:`, err);
    return null;
  }
}

async function findJellyfinSeriesId(showTmdbId: string): Promise<string | null> {
  const result = await jellyfinFetch<{ Items: { Id: string }[] }>(
    `/Items?AnyProviderIdEquals=Tmdb.${showTmdbId}&IncludeItemTypes=Series&Recursive=true`
  );
  return result.Items[0]?.Id ?? null;
}

/** A specific episode's direct-play stream URL. Null if the show or that episode isn't scanned in yet. */
export async function getJellyfinEpisodeUrl(
  showTmdbId: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<string | null> {
  if (!isJellyfinConfigured()) return null;
  try {
    const seriesId = await findJellyfinSeriesId(showTmdbId);
    if (!seriesId) return null;

    const episodes = await jellyfinFetch<{ Items: { Id: string; IndexNumber?: number }[] }>(
      `/Shows/${seriesId}/Episodes?seasonNumber=${seasonNumber}`
    );
    const episode = episodes.Items.find((e) => e.IndexNumber === episodeNumber);
    return episode ? streamUrl(episode.Id) : null;
  } catch (err) {
    console.error(
      `[jellyfin] getJellyfinEpisodeUrl failed for show ${showTmdbId} S${seasonNumber}E${episodeNumber}:`,
      err
    );
    return null;
  }
}

/** Whether a show has at least one episode scanned into Jellyfin -- used to gate the Play/Download choice. */
export async function isJellyfinShowAvailable(showTmdbId: string): Promise<boolean> {
  if (!isJellyfinConfigured()) return false;
  try {
    const seriesId = await findJellyfinSeriesId(showTmdbId);
    if (!seriesId) return false;
    const episodes = await jellyfinFetch<{ TotalRecordCount: number }>(
      `/Shows/${seriesId}/Episodes?limit=1`
    );
    return episodes.TotalRecordCount > 0;
  } catch (err) {
    console.error(`[jellyfin] isJellyfinShowAvailable failed for tmdbId ${showTmdbId}:`, err);
    return false;
  }
}
