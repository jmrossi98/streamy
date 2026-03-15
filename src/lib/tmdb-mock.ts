/**
 * Mock TMDB responses for development (npm run dev).
 * Production (npm run build / start) uses the real API in tmdb.ts.
 */

import type { Movie, MovieDetail, TVShow, TVSeason, TVEpisode } from "./tmdb";

const PLACEHOLDER = "https://placehold.co/400x600/1a1a1a/666?text=Poster";
const BACKDROP = "https://placehold.co/1920x1080/1a1a1a/444?text=Backdrop";

const MOCK_GENRES = [
  { id: 28, name: "Action" },
  { id: 35, name: "Comedy" },
  { id: 18, name: "Drama" },
  { id: 27, name: "Horror" },
  { id: 878, name: "Science Fiction" },
  { id: 53, name: "Thriller" },
];

function mockMovie(overrides: Partial<Movie> & { id: string }): Movie {
  return {
    id: overrides.id,
    title: overrides.title ?? "Mock Movie",
    overview: overrides.overview ?? "Mock overview for development.",
    poster: overrides.poster ?? PLACEHOLDER,
    backdrop: overrides.backdrop ?? BACKDROP,
    year: overrides.year ?? "2024",
    rating: overrides.rating ?? 7.5,
    duration: overrides.duration ?? "",
    genres: overrides.genres ?? ["Drama"],
  };
}

function mockMovieDetail(overrides: Partial<MovieDetail> & { id: string }): MovieDetail {
  const base = mockMovie(overrides);
  return {
    ...base,
    runtime: overrides.runtime ?? 120,
    duration: overrides.duration ?? "2h 0m",
    flatrate: overrides.flatrate,
    rent: overrides.rent,
    buy: overrides.buy,
  };
}

const MOCK_MOVIES: Movie[] = Array.from({ length: 20 }, (_, i) =>
  mockMovie({
    id: String(1000 + i),
    title: `Mock Movie ${i + 1}`,
    overview: `Mock description for movie ${i + 1}. Use npm run build && npm run start for real API.`,
    year: String(2023 + (i % 2)),
    rating: 6 + (i % 4) * 0.5,
    genres: [MOCK_GENRES[i % MOCK_GENRES.length].name],
  })
);

const MOCK_MOVIE_DETAILS = new Map<string, MovieDetail>(
  MOCK_MOVIES.slice(0, 5).map((m, i) => [
    m.id,
    mockMovieDetail({
      ...m,
      runtime: 90 + i * 15,
      duration: `${1 + Math.floor((90 + i * 15) / 60)}h ${(90 + i * 15) % 60}m`,
    }),
  ])
);

function mockTVShow(overrides: Partial<TVShow> & { id: string }): TVShow {
  return {
    id: overrides.id,
    name: overrides.name ?? "Mock Show",
    overview: overrides.overview ?? "Mock show overview.",
    poster: overrides.poster ?? PLACEHOLDER,
    backdrop: overrides.backdrop ?? BACKDROP,
    year: overrides.year ?? "2024",
    rating: overrides.rating ?? 7.5,
    genres: overrides.genres ?? ["Drama"],
  };
}

const MOCK_TV_GENRES = [
  { id: 10759, name: "Action & Adventure" },
  { id: 35, name: "Comedy" },
  { id: 18, name: "Drama" },
];

const MOCK_TV_SHOWS: TVShow[] = Array.from({ length: 15 }, (_, i) =>
  mockTVShow({
    id: String(2000 + i),
    name: `Mock Show ${i + 1}`,
    overview: `Mock TV show description ${i + 1}.`,
    year: String(2022 + (i % 3)),
    rating: 7 + (i % 3) * 0.3,
    genres: [MOCK_TV_GENRES[i % MOCK_TV_GENRES.length].name],
  })
);

function mockEpisode(season: number, ep: number): TVEpisode {
  return {
    id: `ep-s${season}-e${ep}`,
    name: `Episode ${ep}`,
    overview: "Mock episode overview.",
    still: PLACEHOLDER,
    seasonNumber: season,
    episodeNumber: ep,
    runtime: 45,
  };
}

function mockSeason(showId: string, seasonNumber: number, episodeCount: number): TVSeason {
  return {
    seasonNumber,
    name: `Season ${seasonNumber}`,
    episodeCount,
    episodes: Array.from({ length: episodeCount }, (_, i) =>
      mockEpisode(seasonNumber, i + 1)
    ),
  };
}

export async function mockGetGenres() {
  return MOCK_GENRES;
}

export async function mockGetTrending(limit = 10): Promise<Movie[]> {
  return Promise.resolve(MOCK_MOVIES.slice(0, limit));
}

export async function mockGetDiscoverByGenre(_genreId: number, limit = 12): Promise<Movie[]> {
  return Promise.resolve(MOCK_MOVIES.slice(0, limit));
}

export async function mockSearchMovies(query: string, limit = 12, _page = 1): Promise<Movie[]> {
  const q = query.toLowerCase();
  const filtered = MOCK_MOVIES.filter(
    (m) => m.title.toLowerCase().includes(q) || m.overview.toLowerCase().includes(q)
  );
  return Promise.resolve(filtered.slice(0, limit));
}

export async function mockGetMovieById(id: string): Promise<MovieDetail | null> {
  const cached = MOCK_MOVIE_DETAILS.get(id);
  if (cached) return cached;
  const listMovie = MOCK_MOVIES.find((m) => m.id === id);
  if (listMovie)
    return mockMovieDetail({ ...listMovie, runtime: 105, duration: "1h 45m" });
  // In dev, any id returns a synthetic movie so /api/movies/[id] never 404s (e.g. client cache has real ids).
  return mockMovieDetail({
    id,
    title: `Movie ${id}`,
    overview: "Mock movie for development. Use production build for real data.",
    year: "2024",
    rating: 7,
    runtime: 120,
    duration: "2h 0m",
    genres: ["Drama"],
  });
}

export async function mockGetTVGenres() {
  return MOCK_TV_GENRES;
}

export async function mockGetTrendingTV(limit = 10): Promise<TVShow[]> {
  return Promise.resolve(MOCK_TV_SHOWS.slice(0, limit));
}

export async function mockGetDiscoverTVByGenre(_genreId: number, limit = 12): Promise<TVShow[]> {
  return Promise.resolve(MOCK_TV_SHOWS.slice(0, limit));
}

export async function mockSearchTVShows(query: string, limit = 12, _page = 1): Promise<TVShow[]> {
  const q = query.toLowerCase();
  const filtered = MOCK_TV_SHOWS.filter(
    (s) => s.name.toLowerCase().includes(q) || s.overview.toLowerCase().includes(q)
  );
  return Promise.resolve(filtered.slice(0, limit));
}

export async function mockGetShowById(id: string): Promise<(TVShow & { numberOfSeasons: number }) | null> {
  const show = MOCK_TV_SHOWS.find((s) => s.id === id);
  if (!show) return null;
  return { ...show, numberOfSeasons: 3 };
}

export async function mockGetSeason(showId: string, seasonNumber: number): Promise<TVSeason | null> {
  const show = MOCK_TV_SHOWS.find((s) => s.id === showId);
  if (!show) return null;
  const epCount = seasonNumber === 1 ? 10 : seasonNumber === 2 ? 8 : 6;
  return mockSeason(showId, seasonNumber, epCount);
}
