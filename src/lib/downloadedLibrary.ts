/**
 * What is actually on disk, as browsable rows.
 *
 * Everything else on Home is a recommendation -- trending, genres, a saved
 * list of things the viewer might want later. None of it distinguishes a
 * title you can press play on right now from one that would have to be
 * fetched first. That distinction is the most useful one on a self-hosted
 * library and it had no representation in the UI.
 *
 * Radarr and Sonarr are the source rather than Jellyfin, because both already
 * carry the TMDB id this app is keyed on. Jellyfin knows the files but is
 * keyed on its own item ids, so using it would mean a name-matching step that
 * fails on exactly the titles that are hardest to match.
 */
import { getMovieById, getShowById, type Movie, type TVShow } from "./tmdb";

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Cap on how many titles a row resolves. Each one is a TMDB detail lookup, so
 * an unbounded library would turn this row into the slowest thing on the page
 * -- and nobody scrolls a hundred tiles sideways anyway.
 */
const ROW_LIMIT = 20;

function radarrBase(): { url: string; key: string } | null {
  const url = process.env.RADARR_URL?.replace(/\/$/, "");
  const key = process.env.RADARR_API_KEY;
  return url && key ? { url, key } : null;
}

function sonarrBase(): { url: string; key: string } | null {
  const url = process.env.SONARR_URL?.replace(/\/$/, "");
  const key = process.env.SONARR_API_KEY;
  return url && key ? { url, key } : null;
}

async function fetchJson<T>(url: string, key: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // A row that cannot load is a row that is not shown. This must never take
    // the page down with it -- see PanelBoundary for the admin-side version of
    // the same rule.
    return null;
  }
}

type RadarrMovie = {
  tmdbId?: number;
  hasFile?: boolean;
  movieFile?: { dateAdded?: string } | null;
};

type SonarrSeries = {
  tmdbId?: number;
  added?: string;
  statistics?: { episodeFileCount?: number } | null;
};

/** Newest first, by when the file landed rather than when it was requested. */
export async function getDownloadedMovies(): Promise<Movie[]> {
  const base = radarrBase();
  if (!base) return [];

  const all = await fetchJson<RadarrMovie[]>(`${base.url}/api/v3/movie`, base.key);
  if (!all) return [];

  const ids = all
    .filter((m) => m.hasFile && m.tmdbId)
    .sort((a, b) => (b.movieFile?.dateAdded ?? "").localeCompare(a.movieFile?.dateAdded ?? ""))
    .slice(0, ROW_LIMIT)
    .map((m) => String(m.tmdbId));

  const details = await Promise.all(ids.map((id) => getMovieById(id)));
  return details.filter((m): m is NonNullable<typeof m> => m != null);
}

/**
 * Shows with at least one episode on disk.
 *
 * Deliberately not "complete" shows: a series you are midway through is
 * exactly the thing you want to reach for, and waiting for every episode
 * before it appears would hide the show you are actually watching.
 */
export async function getDownloadedShows(): Promise<(TVShow & { numberOfSeasons: number })[]> {
  const base = sonarrBase();
  if (!base) return [];

  const all = await fetchJson<SonarrSeries[]>(`${base.url}/api/v3/series`, base.key);
  if (!all) return [];

  const ids = all
    .filter((s) => (s.statistics?.episodeFileCount ?? 0) > 0 && s.tmdbId)
    .sort((a, b) => (b.added ?? "").localeCompare(a.added ?? ""))
    .slice(0, ROW_LIMIT)
    .map((s) => String(s.tmdbId));

  const details = await Promise.all(ids.map((id) => getShowById(id)));
  return details.filter((s): s is NonNullable<typeof s> => s != null);
}
