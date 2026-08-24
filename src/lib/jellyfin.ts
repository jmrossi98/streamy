/**
 * Jellyfin API client (server-side only). Set JELLYFIN_URL/JELLYFIN_API_KEY
 * in env to enable. Streamy streams from Jellyfin (which already scans
 * Radarr/Sonarr's output folders) rather than staging a copy in S3 --
 * titles become playable as soon as Jellyfin scans them in, no upload step.
 *
 * Playback is proxied through Streamy's own origin (/api/stream/*) rather
 * than pointing the browser straight at JELLYFIN_URL, because that URL is a
 * Tailscale-only address on plain HTTP: a viewer's browser can't route to it,
 * and an HTTPS page can't load HTTP media anyway (mixed content). Proxying
 * also keeps JELLYFIN_API_KEY server-side instead of embedding it in a URL
 * handed to the client.
 */

const JELLYFIN_URL = process.env.JELLYFIN_URL?.replace(/\/$/, "");
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;

export function isJellyfinConfigured(): boolean {
  return !!(JELLYFIN_URL && JELLYFIN_API_KEY);
}

async function jellyfinFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${JELLYFIN_URL}${path}`, {
    headers: { "X-Emby-Token": JELLYFIN_API_KEY! },
    // Library contents change as downloads land; never serve a stale "not
    // available yet" answer from Next's fetch cache.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Jellyfin API error: ${res.status}`);
  }
  return res.json();
}

type JellyfinItem = {
  Id: string;
  ProviderIds?: Record<string, string>;
  LocationType?: string;
  IndexNumber?: number;
};

/**
 * Jellyfin's `AnyProviderIdEquals` filter is silently ignored on this server
 * version -- it returns the whole library regardless of the id passed, which
 * made every title resolve to whichever movie happened to be present. So we
 * pull ProviderIds and match here instead. Personal-library sized, so listing
 * is cheap.
 */
function matchesTmdbId(item: JellyfinItem, tmdbId: string): boolean {
  const ids = item.ProviderIds ?? {};
  const value = ids.Tmdb ?? ids.tmdb ?? ids.TMDB;
  return value === tmdbId;
}

/** A real file on disk -- not a metadata-only stub Jellyfin created for a folder with no media yet. */
function isPlayable(item: JellyfinItem): boolean {
  return item.LocationType === "FileSystem";
}

// Radarr/Sonarr are supposed to poke Jellyfin to rescan on import, but that
// notification doesn't always land -- a finished movie then sits on disk,
// invisible to Jellyfin, and the title shows "Downloaded" with no way to
// play it. Asking Jellyfin to rescan when we come up empty closes that gap
// on its own. Rate-limited because scans are not free and every viewer polls.
const SCAN_COOLDOWN_MS = 60 * 1000;
let lastScanRequestedAt = 0;

function requestJellyfinLibraryScan(): void {
  if (!isJellyfinConfigured()) return;
  if (Date.now() - lastScanRequestedAt < SCAN_COOLDOWN_MS) return;
  lastScanRequestedAt = Date.now();
  fetch(`${JELLYFIN_URL}/Library/Refresh`, {
    method: "POST",
    headers: { "X-Emby-Token": JELLYFIN_API_KEY! },
    cache: "no-store",
  }).catch((err) => console.error("[jellyfin] library refresh failed:", err));
}

/** Jellyfin item id for a movie, by TMDB id. Null until it's actually scanned in with a real file. */
export async function findJellyfinMovieItemId(tmdbId: string): Promise<string | null> {
  if (!isJellyfinConfigured()) return null;
  try {
    const result = await jellyfinFetch<{ Items: JellyfinItem[] }>(
      `/Items?IncludeItemTypes=Movie&Recursive=true&fields=ProviderIds`
    );
    const item = result.Items.find((i) => matchesTmdbId(i, tmdbId) && isPlayable(i));
    if (!item) requestJellyfinLibraryScan();
    return item?.Id ?? null;
  } catch (err) {
    console.error(`[jellyfin] findJellyfinMovieItemId failed for tmdbId ${tmdbId}:`, err);
    return null;
  }
}

async function findJellyfinSeriesId(showTmdbId: string): Promise<string | null> {
  const result = await jellyfinFetch<{ Items: JellyfinItem[] }>(
    `/Items?IncludeItemTypes=Series&Recursive=true&fields=ProviderIds`
  );
  return result.Items.find((i) => matchesTmdbId(i, showTmdbId))?.Id ?? null;
}

/** Jellyfin item id for one episode. Null if the show or that specific episode isn't scanned in yet. */
export async function findJellyfinEpisodeItemId(
  showTmdbId: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<string | null> {
  if (!isJellyfinConfigured()) return null;
  try {
    const seriesId = await findJellyfinSeriesId(showTmdbId);
    if (!seriesId) return null;

    const episodes = await jellyfinFetch<{ Items: JellyfinItem[] }>(
      `/Shows/${seriesId}/Episodes?seasonNumber=${seasonNumber}&fields=ProviderIds`
    );
    const episode = episodes.Items.find((e) => e.IndexNumber === episodeNumber && isPlayable(e));
    if (!episode) requestJellyfinLibraryScan();
    return episode?.Id ?? null;
  } catch (err) {
    console.error(
      `[jellyfin] findJellyfinEpisodeItemId failed for show ${showTmdbId} S${seasonNumber}E${episodeNumber}:`,
      err
    );
    return null;
  }
}

/** Whether a show has at least one real episode file scanned in -- gates Play vs. Download. */
export async function isJellyfinShowAvailable(showTmdbId: string): Promise<boolean> {
  if (!isJellyfinConfigured()) return false;
  try {
    const seriesId = await findJellyfinSeriesId(showTmdbId);
    if (!seriesId) {
      requestJellyfinLibraryScan();
      return false;
    }
    const episodes = await jellyfinFetch<{ Items: JellyfinItem[] }>(
      `/Shows/${seriesId}/Episodes?fields=ProviderIds`
    );
    const available = episodes.Items.some(isPlayable);
    if (!available) requestJellyfinLibraryScan();
    return available;
  } catch (err) {
    console.error(`[jellyfin] isJellyfinShowAvailable failed for tmdbId ${showTmdbId}:`, err);
    return false;
  }
}

/**
 * Upstream Jellyfin URL for an item's raw file. Server-side only -- this
 * carries the API key, so it must never be handed to the browser; the
 * /api/stream/* proxy routes fetch it and pipe the bytes back instead.
 */
export function jellyfinUpstreamStreamUrl(itemId: string): string {
  return `${JELLYFIN_URL}/Videos/${itemId}/stream?static=true&api_key=${JELLYFIN_API_KEY}`;
}
