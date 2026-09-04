/**
 * Server-only watchlist helpers for the My List page.
 */
import { prisma } from "@/lib/db";
import { getMovieById, getShowById } from "@/lib/tmdb";
import type { Movie, TVShow } from "@/lib/tmdb";
import type { MovieProgress } from "@/components/MovieRow";
import { getGamesList, type GameListItem } from "@/lib/games";

export type WatchlistData = {
  movies: Movie[];
  shows: (TVShow & { numberOfSeasons: number })[];
  games: GameListItem[];
  progressMap: Record<string, MovieProgress>;
};

/** Loads all saved movies, TV shows, and games; rows scroll horizontally (ScrollableRow) like Home/Movies. */
export async function getWatchlist(userId: string): Promise<WatchlistData> {
  const [movieItems, showItems, gameItems, allProgress] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    }),
    prisma.watchlistShowItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    }),
    // Cheap even for a non-admin (whose set is always empty, since they have
    // no UI to ever add one) -- gates the actual gamarr round trip below so
    // every other My List page doesn't pay for one on every load.
    prisma.watchlistGameItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
      select: { gameKey: true },
    }),
    prisma.watchProgress.findMany({ where: { userId } }),
  ]);

  const gameKeys = new Set(gameItems.map((i) => i.gameKey));
  const games =
    gameKeys.size > 0
      ? (await getGamesList()).filter((g) => gameKeys.has(g.gameKey))
      : [];

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
    games,
    progressMap,
  };
}
