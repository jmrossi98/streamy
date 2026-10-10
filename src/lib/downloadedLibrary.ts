/**
 * What is actually on disk: the titles every browse row is drawn from.
 *
 * Home, Movies and TV Shows used to be recommendations -- trending, genres --
 * with one "Downloaded" row for the part you could press play on. The library
 * is now big enough to be the whole page, so the rows are built from this and
 * anything else is reached through search.
 *
 * Radarr and Sonarr are the source rather than Jellyfin, because both already
 * carry the TMDB id this app is keyed on. Jellyfin knows the files but is
 * keyed on its own item ids, so using it would mean a name-matching step that
 * fails on exactly the titles that are hardest to match.
 */
import { getMovieById, getShowById, getShowBrowseMeta, type Movie, type TVShow } from "./tmdb";
import { cached } from "./ttlCache";

const PROBE_TIMEOUT_MS = 8_000;

/**
 * How long a read of the library is reused. Every browse page and every shelf
 * asks for it, and it only changes when a download finishes -- a minute is
 * soon enough for a new title to appear and spares Radarr a call per render.
 */
const LIBRARY_TTL_MS = 60_000;

/** A downloaded movie: its card, plus what the rows sort and match on. */
export type LibraryMovie = Movie & { keywords: string[] };
export type LibraryShow = TVShow & { keywords: string[] };

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
    // An unreadable library is reported as null, never thrown: the pages fall
    // back to TMDB's lists rather than going down with the home server.
    return null;
  }
}

type RadarrMovie = {
  tmdbId?: number;
  hasFile?: boolean;
  popularity?: number;
  keywords?: string[];
};

type SonarrSeries = {
  tmdbId?: number;
  statistics?: { episodeFileCount?: number } | null;
};

async function loadMovies(): Promise<LibraryMovie[] | null> {
  const base = radarrBase();
  if (!base) return null;

  const all = await fetchJson<RadarrMovie[]>(`${base.url}/api/v3/movie`, base.key);
  if (!all) return null;

  const onDisk = all.filter((m) => m.hasFile && m.tmdbId);
  const details = await Promise.all(onDisk.map((m) => getMovieById(String(m.tmdbId)).catch(() => null)));

  return onDisk.flatMap((radarr, i) => {
    const d = details[i];
    if (!d) return [];
    // Field by field rather than spread: the detail record also carries
    // credits and watch providers, and these go to the browser once per row
    // the title appears in.
    return [
      {
        id: d.id,
        title: d.title,
        overview: d.overview,
        poster: d.poster,
        backdrop: d.backdrop,
        year: d.year,
        releaseDate: d.releaseDate,
        rating: d.rating,
        duration: d.duration,
        // TMDB's genres rather than Radarr's copy of them, so a title is
        // shelved under exactly what its own page says it is.
        genres: d.genres,
        popularity: radarr.popularity ?? 0,
        keywords: radarr.keywords ?? [],
      },
    ];
  });
}

/**
 * Shows with at least one episode on disk.
 *
 * Deliberately not "complete" shows: a series you are midway through is
 * exactly the thing you want to reach for, and waiting for every episode
 * before it appears would hide the show you are actually watching.
 */
async function loadShows(): Promise<LibraryShow[] | null> {
  const base = sonarrBase();
  if (!base) return null;

  const all = await fetchJson<SonarrSeries[]>(`${base.url}/api/v3/series`, base.key);
  if (!all) return null;

  const ids = all.filter((s) => (s.statistics?.episodeFileCount ?? 0) > 0 && s.tmdbId).map((s) => String(s.tmdbId));
  const resolved = await Promise.all(
    ids.map((id) => Promise.all([getShowById(id).catch(() => null), getShowBrowseMeta(id)]))
  );

  return resolved.flatMap(([d, meta]) => {
    if (!d) return [];
    return [
      {
        id: d.id,
        name: d.name,
        overview: d.overview,
        poster: d.poster,
        backdrop: d.backdrop,
        year: d.year,
        releaseDate: d.releaseDate,
        rating: d.rating,
        genres: d.genres,
        popularity: meta?.popularity ?? 0,
        keywords: meta?.keywords ?? [],
      },
    ];
  });
}

/**
 * The last library that loaded. A Radarr restart or a dropped tunnel should
 * leave the rows as they were a minute ago, not swap the whole page for
 * TMDB's trending list until it comes back.
 */
let lastMovies: LibraryMovie[] | null = null;
let lastShows: LibraryShow[] | null = null;

/** Every downloaded movie, or null when the library cannot be read at all. */
export async function getLibraryMovies(): Promise<LibraryMovie[] | null> {
  const fresh = await cached("library:movies", LIBRARY_TTL_MS, loadMovies, { skipCacheIf: (v) => v === null });
  if (fresh) lastMovies = fresh;
  return fresh ?? lastMovies;
}

/** Every show with something downloaded, or null when the library cannot be read at all. */
export async function getLibraryShows(): Promise<LibraryShow[] | null> {
  const fresh = await cached("library:shows", LIBRARY_TTL_MS, loadShows, { skipCacheIf: (v) => v === null });
  if (fresh) lastShows = fresh;
  return fresh ?? lastShows;
}
