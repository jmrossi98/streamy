/**
 * TMDB API client (server-side only). Set TMDB_API_KEY in env.
 * @see https://developer.themoviedb.org/reference
 * Uses in-memory L1 cache (24h) + Next.js unstable_cache (24h) to avoid re-hitting the API.
 * In development (npm run dev) uses mock responses; in production uses the real API.
 */

import { cache } from "react";
import { unstable_cache } from "next/cache";
import * as mock from "./tmdb-mock";

const USE_MOCK = process.env.NODE_ENV === "development";

const ONE_DAY_SEC = 86400;
const ONE_DAY_MS = ONE_DAY_SEC * 1000;

const memoryCache = new Map<string, { value: unknown; expires: number }>();

async function withMemoryCache<T>(keyParts: string[], ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const k = keyParts.join(":");
  const entry = memoryCache.get(k);
  if (entry && entry.expires > Date.now()) return entry.value as T;
  const value = await fn();
  memoryCache.set(k, { value, expires: Date.now() + ttlMs });
  return value;
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";

export type Movie = {
  id: string;
  title: string;
  overview: string;
  poster: string;
  backdrop: string;
  year: string;
  rating: number;
  duration: string;
  genres: string[];
};

export type WatchProviderItem = {
  id: number;
  name: string;
  logoPath: string;
};

export type MovieDetail = Movie & {
  runtime: number | null;
  flatrate?: WatchProviderItem[];
  rent?: WatchProviderItem[];
  buy?: WatchProviderItem[];
};

type TmdbMovieResult = {
  id: number;
  title: string;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  vote_average: number;
  genre_ids?: number[];
};

type TmdbGenre = { id: number; name: string };

type TmdbWatchProvider = { provider_id: number; provider_name: string; logo_path: string };

function getApiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set. Get a free key at https://www.themoviedb.org/settings/api");
  return key;
}

async function fetchTmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = getApiKey();
  const base = TMDB_BASE.endsWith("/") ? TMDB_BASE : TMDB_BASE + "/";
  const url = new URL(path.replace(/^\//, ""), base);
  url.searchParams.set("api_key", key);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { next: { revalidate: ONE_DAY_SEC } });
  if (!res.ok) throw new Error(`TMDB API error: ${res.status}`);
  return res.json();
}

const PLACEHOLDER_POSTER =
  "https://placehold.co/400x600/1a1a1a/666?text=No+Poster";

function imageUrl(path: string | null, size: "w92" | "w500" | "original" = "w500"): string {
  if (!path) return PLACEHOLDER_POSTER;
  return `${IMAGE_BASE}/${size}${path}`;
}

function toMovie(r: TmdbMovieResult, genres: TmdbGenre[]): Movie {
  const year = r.release_date ? r.release_date.slice(0, 4) : "";
  const genreNames = (r.genre_ids || [])
    .map((gid) => genres.find((g) => g.id === gid)?.name)
    .filter(Boolean) as string[];
  return {
    id: String(r.id),
    title: r.title,
    overview: r.overview || "",
    poster: imageUrl(r.poster_path),
    backdrop: imageUrl(r.backdrop_path, "original"),
    year,
    rating: Math.round(r.vote_average * 10) / 10,
    duration: "", // filled in detail
    genres: genreNames,
  };
}

const CACHE_REVALIDATE = ONE_DAY_SEC; // 24 hours

async function getGenresUncached(): Promise<TmdbGenre[]> {
  const data = await fetchTmdb<{ genres: TmdbGenre[] }>("genre/movie/list");
  return data.genres;
}

export async function getGenres(): Promise<TmdbGenre[]> {
  if (USE_MOCK) return mock.mockGetGenres();
  return withMemoryCache(
    ["tmdb-genres"],
    ONE_DAY_MS,
    () => unstable_cache(getGenresUncached, ["tmdb-genres"], { revalidate: CACHE_REVALIDATE })()
  );
}

export async function getTrending(limit = 10): Promise<Movie[]> {
  return withMemoryCache(
    ["tmdb-trending", String(limit)],
    ONE_DAY_MS,
    () =>
      unstable_cache(
        async () => {
          const [data, genres] = await Promise.all([
            fetchTmdb<{ results: TmdbMovieResult[] }>("trending/movie/week"),
            getGenresUncached(),
          ]);
          return data.results.slice(0, limit).map((r) => toMovie(r, genres));
        },
        ["tmdb-trending", String(limit)],
        { revalidate: CACHE_REVALIDATE }
      )()
  );
}

export async function getDiscoverByGenre(genreId: number, limit = 12): Promise<Movie[]> {
  if (USE_MOCK) return mock.mockGetDiscoverByGenre(genreId, limit);
  return withMemoryCache(
    ["tmdb-discover-movie", String(genreId), String(limit)],
    ONE_DAY_MS,
    () =>
      unstable_cache(
        async () => {
          const [data, genres] = await Promise.all([
            fetchTmdb<{ results: TmdbMovieResult[] }>("discover/movie", {
              with_genres: String(genreId),
              sort_by: "popularity.desc",
            }),
            getGenresUncached(),
          ]);
          return data.results.slice(0, limit).map((r) => toMovie(r, genres));
        },
        ["tmdb-discover-movie", String(genreId), String(limit)],
        { revalidate: CACHE_REVALIDATE }
      )()
  );
}

const SEARCH_CACHE_REVALIDATE = 3600; // 1 hour for search

export async function searchMovies(query: string, limit = 12, page = 1): Promise<Movie[]> {
  const q = query.trim();
  if (!q) return [];
  return withMemoryCache(
    ["tmdb-search-movies", q, String(limit), String(page)],
    ONE_DAY_MS,
    () =>
      unstable_cache(
        async () => {
          const [data, genres] = await Promise.all([
            fetchTmdb<{ results: TmdbMovieResult[] }>("search/movie", {
              query: q,
              page: String(page),
            }),
            getGenres(),
          ]);
          return data.results.slice(0, limit).map((r) => toMovie(r, genres));
        },
        ["tmdb-search-movies", q, String(limit), String(page)],
        { revalidate: SEARCH_CACHE_REVALIDATE }
      )()
  );
}

// --- TV types and helpers ---
export type TVShow = {
  id: string;
  name: string;
  overview: string;
  poster: string;
  backdrop: string;
  year: string;
  rating: number;
  genres: string[];
};

export type TVSeason = {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  episodes: TVEpisode[];
};

export type TVEpisode = {
  id: string;
  name: string;
  overview: string;
  still: string;
  seasonNumber: number;
  episodeNumber: number;
  runtime: number | null;
};

type TmdbTVResult = {
  id: number;
  name: string;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date?: string;
  vote_average: number;
  genre_ids?: number[];
};

type TmdbGenreTV = { id: number; name: string };

async function getTVGenresUncached(): Promise<TmdbGenreTV[]> {
  const data = await fetchTmdb<{ genres: TmdbGenreTV[] }>("genre/tv/list");
  return data.genres;
}

export async function getTVGenres(): Promise<TmdbGenreTV[]> {
  if (USE_MOCK) return mock.mockGetTVGenres();
  return withMemoryCache(
    ["tmdb-tv-genres"],
    ONE_DAY_MS,
    () => unstable_cache(getTVGenresUncached, ["tmdb-tv-genres"], { revalidate: CACHE_REVALIDATE })()
  );
}

function toTVShow(r: TmdbTVResult, genres: TmdbGenreTV[]): TVShow {
  const year = r.first_air_date ? r.first_air_date.slice(0, 4) : "";
  const genreNames = (r.genre_ids || [])
    .map((gid) => genres.find((g) => g.id === gid)?.name)
    .filter(Boolean) as string[];
  return {
    id: String(r.id),
    name: r.name,
    overview: r.overview || "",
    poster: imageUrl(r.poster_path),
    backdrop: imageUrl(r.backdrop_path, "original"),
    year,
    rating: Math.round(r.vote_average * 10) / 10,
    genres: genreNames,
  };
}

async function getShowByIdUncached(id: string): Promise<(TVShow & { numberOfSeasons: number }) | null> {
  const data = await fetchTmdb<{
    id: number;
    name: string;
    overview: string | null;
    poster_path: string | null;
    backdrop_path: string | null;
    first_air_date?: string;
    vote_average: number;
    genres: { id: number; name: string }[];
    number_of_seasons: number;
  }>(`tv/${id}`);
  if (!data) return null;
  const genres = (data.genres || []).map((g: { name: string }) => g.name);
  return {
    id: String(data.id),
    name: data.name,
    overview: data.overview || "",
    poster: imageUrl(data.poster_path),
    backdrop: imageUrl(data.backdrop_path, "original"),
    year: data.first_air_date ? data.first_air_date.slice(0, 4) : "",
    rating: Math.round((data.vote_average || 0) * 10) / 10,
    genres,
    numberOfSeasons: data.number_of_seasons || 1,
  };
}

export const getShowById = cache((id: string) =>
  USE_MOCK
    ? mock.mockGetShowById(id)
    : withMemoryCache(
        ["tmdb-show", id],
        ONE_DAY_MS,
        () => unstable_cache(() => getShowByIdUncached(id), ["tmdb-show", id], { revalidate: CACHE_REVALIDATE })()
      )
);

export async function getSeason(showId: string, seasonNumber: number): Promise<TVSeason | null> {
  return withMemoryCache(
    ["tmdb-season", showId, String(seasonNumber)],
    ONE_DAY_MS,
    () =>
      unstable_cache(
        async () => {
          try {
            const data = await fetchTmdb<{
              name: string;
              episodes: {
                id: number;
                name: string;
                overview: string | null;
                still_path: string | null;
                season_number: number;
                episode_number: number;
                runtime: number | null;
              }[];
            }>(`tv/${showId}/season/${seasonNumber}`);
            if (!data?.episodes) return null;
            return {
              seasonNumber,
              name: data.name || `Season ${seasonNumber}`,
              episodeCount: data.episodes.length,
              episodes: data.episodes.map((ep) => ({
                id: String(ep.id),
                name: ep.name,
                overview: ep.overview || "",
                still: imageUrl(ep.still_path),
                seasonNumber: ep.season_number,
                episodeNumber: ep.episode_number,
                runtime: ep.runtime ?? null,
              })),
            };
          } catch (err) {
            if (err instanceof Error && err.message.includes("404")) return null;
            throw err;
          }
        },
        ["tmdb-season", showId, String(seasonNumber)],
        { revalidate: CACHE_REVALIDATE }
      )()
  );
}

export async function searchTVShows(query: string, limit = 12, page = 1): Promise<TVShow[]> {
  const q = query.trim();
  if (!q) return [];
  if (USE_MOCK) return mock.mockSearchTVShows(q, limit, page);
  return withMemoryCache(
    ["tmdb-search-tv", q, String(limit), String(page)],
    ONE_DAY_MS,
    () =>
      unstable_cache(
        async () => {
          const [data, genres] = await Promise.all([
            fetchTmdb<{ results: TmdbTVResult[] }>("search/tv", { query: q, page: String(page) }),
            getTVGenres(),
          ]);
          return data.results.slice(0, limit).map((r) => toTVShow(r, genres));
        },
        ["tmdb-search-tv", q, String(limit), String(page)],
        { revalidate: SEARCH_CACHE_REVALIDATE }
      )()
  );
}

export async function getTrendingTV(limit = 10): Promise<TVShow[]> {
  if (USE_MOCK) return mock.mockGetTrendingTV(limit);
  return withMemoryCache(
    ["tmdb-trending-tv", String(limit)],
    ONE_DAY_MS,
    () =>
      unstable_cache(
        async () => {
          const [data, genres] = await Promise.all([
            fetchTmdb<{ results: TmdbTVResult[] }>("trending/tv/week"),
            getTVGenresUncached(),
          ]);
          return data.results.slice(0, limit).map((r) => toTVShow(r, genres));
        },
        ["tmdb-trending-tv", String(limit)],
        { revalidate: CACHE_REVALIDATE }
      )()
  );
}

export async function getDiscoverTVByGenre(genreId: number, limit = 12): Promise<TVShow[]> {
  return withMemoryCache(
    ["tmdb-discover-tv", String(genreId), String(limit)],
    ONE_DAY_MS,
    () =>
      unstable_cache(
        async () => {
          const [data, genres] = await Promise.all([
            fetchTmdb<{ results: TmdbTVResult[] }>("discover/tv", {
              with_genres: String(genreId),
              sort_by: "popularity.desc",
            }),
            getTVGenresUncached(),
          ]);
          return data.results.slice(0, limit).map((r) => toTVShow(r, genres));
        },
        ["tmdb-discover-tv", String(genreId), String(limit)],
        { revalidate: CACHE_REVALIDATE }
      )()
  );
}

async function getMovieByIdUncached(id: string): Promise<MovieDetail | null> {
  const key = getApiKey();
  const [movieRes, providersRes] = await Promise.all([
    fetch(
      `${TMDB_BASE}/movie/${id}?api_key=${key}&language=en-US`,
      { next: { revalidate: CACHE_REVALIDATE } }
    ),
    fetch(
      `${TMDB_BASE}/movie/${id}/watch/providers?api_key=${key}`,
      { next: { revalidate: CACHE_REVALIDATE } }
    ),
  ]);

  if (!movieRes.ok) return null;
  const movie = await movieRes.json();
  let flatrate: WatchProviderItem[] = [];
  let rent: WatchProviderItem[] = [];
  let buy: WatchProviderItem[] = [];

  if (providersRes.ok) {
    const prov = await providersRes.json();
    const us = prov.results?.US;
    const map = (arr: TmdbWatchProvider[] | undefined): WatchProviderItem[] =>
      (arr || []).map((p) => ({
        id: p.provider_id,
        name: p.provider_name,
        logoPath: imageUrl(p.logo_path, "w92"),
      }));
    flatrate = map(us?.flatrate);
    rent = map(us?.rent);
    buy = map(us?.buy);
  }

  const runtime = movie.runtime ?? null;
  const duration = runtime ? `${Math.floor(runtime / 60)}h ${runtime % 60}m` : "";
  const genres = (movie.genres || []).map((g: TmdbGenre) => g.name);

  return {
    id: String(movie.id),
    title: movie.title,
    overview: movie.overview || "",
    poster: imageUrl(movie.poster_path),
    backdrop: imageUrl(movie.backdrop_path, "original"),
    year: movie.release_date ? movie.release_date.slice(0, 4) : "",
    rating: Math.round((movie.vote_average || 0) * 10) / 10,
    duration,
    genres,
    runtime,
    flatrate: flatrate.length ? flatrate : undefined,
    rent: rent.length ? rent : undefined,
    buy: buy.length ? buy : undefined,
  };
}

export const getMovieById = cache((id: string) =>
  USE_MOCK
    ? mock.mockGetMovieById(id)
    : withMemoryCache(
        ["tmdb-movie", id],
        ONE_DAY_MS,
        () => unstable_cache(() => getMovieByIdUncached(id), ["tmdb-movie", id], { revalidate: CACHE_REVALIDATE })()
      )
);
