/**
 * Server-only watchlist helpers for the My List page.
 */
import { prisma } from "@/lib/db";
import { getMovieById, getShowById } from "@/lib/tmdb";
import type { Movie, TVShow } from "@/lib/tmdb";
import type { MovieProgress } from "@/components/MovieRow";

export type WatchlistData = {
  movies: Movie[];
  shows: (TVShow & { numberOfSeasons: number })[];
  progressMap: Record<string, MovieProgress>;
};

/** Loads all saved movies and TV shows; rows scroll horizontally (ScrollableRow) like Home/Movies. */
export async function getWatchlist(userId: string): Promise<WatchlistData> {
  const [movieItems, showItems, allProgress] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    }),
    prisma.watchlistShowItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    }),
    prisma.watchProgress.findMany({ where: { userId } }),
  ]);

  const [movieDetails, showDetails] = await Promise.all([
    Promise.all(movieItems.map((item) => getMovieById(item.movieId))),
    Promise.all(showItems.map((item) => getShowById(item.showId))),
  ]);

  const movies: Movie[] = [];
  const progressMap: Record<string, MovieProgress> = {};
  movieDetails.forEach((m) => {
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
  };
}
