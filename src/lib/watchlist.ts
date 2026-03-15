/**
 * Server-only watchlist helpers. Used by watchlist page (page 1) and /api/watchlist/items (page 2+).
 */
import { prisma } from "@/lib/db";
import { getMovieById, getShowById } from "@/lib/tmdb";
import type { Movie, TVShow } from "@/lib/tmdb";
import type { MovieProgress } from "@/components/MovieRow";

const DEFAULT_PAGE_SIZE = 12;

export type WatchlistPageResult = {
  movies: Movie[];
  shows: (TVShow & { numberOfSeasons: number })[];
  progressMap: Record<string, MovieProgress>;
  hasMoreMovies: boolean;
  hasMoreShows: boolean;
};

export async function getWatchlistPage(
  userId: string,
  page: number,
  limit: number = DEFAULT_PAGE_SIZE
): Promise<WatchlistPageResult> {
  const skip = (page - 1) * limit;

  const [movieItems, showItems, totalMovies, totalShows, allProgress] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.watchlistShowItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.watchlistItem.count({ where: { userId } }),
    prisma.watchlistShowItem.count({ where: { userId } }),
    prisma.watchProgress.findMany({ where: { userId } }),
  ]);

  const [movieDetails, showDetails] = await Promise.all([
    Promise.all(movieItems.map((item) => getMovieById(item.movieId))),
    Promise.all(showItems.map((item) => getShowById(item.showId))),
  ]);

  const movies: Movie[] = [];
  const progressMap: Record<string, MovieProgress> = {};
  movieDetails.forEach((m, i) => {
    if (m) {
      movies.push(m);
      const p = allProgress.find((x) => x.movieId === m.id);
      if (p)
        progressMap[m.id] = {
          progressSeconds: p.progressSeconds,
          runtimeMinutes: m.runtime ?? null,
        };
    }
  });

  const shows = showDetails
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({ ...s, numberOfSeasons: s.numberOfSeasons }));

  return {
    movies,
    shows,
    progressMap,
    hasMoreMovies: totalMovies > skip + movieItems.length,
    hasMoreShows: totalShows > skip + showItems.length,
  };
}
