/**
 * TMDB API client (server-side only). Set TMDB_API_KEY in env.
 * @see https://developer.themoviedb.org/reference
 */

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
  const url = new URL(path, TMDB_BASE);
  url.searchParams.set("api_key", key);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`TMDB API error: ${res.status}`);
  return res.json();
}

const PLACEHOLDER_POSTER =
  "https://placehold.co/400x600/1a1a1a/666?text=No+Poster";

function imageUrl(path: string | null, size: "w500" | "original" = "w500"): string {
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

let genresCache: TmdbGenre[] | null = null;

export async function getGenres(): Promise<TmdbGenre[]> {
  if (genresCache) return genresCache;
  const data = await fetchTmdb<{ genres: TmdbGenre[] }>("/genre/movie/list");
  genresCache = data.genres;
  return data.genres;
}

export async function getTrending(limit = 10): Promise<Movie[]> {
  const [data, genres] = await Promise.all([
    fetchTmdb<{ results: TmdbMovieResult[] }>("/trending/movie/week"),
    getGenres(),
  ]);
  return data.results.slice(0, limit).map((r) => toMovie(r, genres));
}

export async function getDiscoverByGenre(genreId: number, limit = 12): Promise<Movie[]> {
  const [data, genres] = await Promise.all([
    fetchTmdb<{ results: TmdbMovieResult[] }>("/discover/movie", {
      with_genres: String(genreId),
      sort_by: "popularity.desc",
    }),
    getGenres(),
  ]);
  return data.results.slice(0, limit).map((r) => toMovie(r, genres));
}

export async function getMovieById(id: string): Promise<MovieDetail | null> {
  const key = getApiKey();
  const [movieRes, providersRes] = await Promise.all([
    fetch(
      `${TMDB_BASE}/movie/${id}?api_key=${key}&language=en-US`,
      { next: { revalidate: 3600 } }
    ),
    fetch(
      `${TMDB_BASE}/movie/${id}/watch/providers?api_key=${key}`,
      { next: { revalidate: 3600 } }
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
