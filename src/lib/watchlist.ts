/**
 * Server-only watchlist helpers for the My List page.
 */
import { prisma } from "@/lib/db";
import { getMovieById, getShowById } from "@/lib/tmdb";
import type { Movie, TVShow } from "@/lib/tmdb";
import type { MovieProgress } from "@/components/MovieRow";
import { getGamesList, type GameListItem } from "@/lib/games";
import { getLiveChannels, type LiveChannel } from "@/lib/liveTv";
import { listFlashGames } from "@/lib/flashGames";
import type { FlashGameSummary } from "@/lib/flashGameRules";

export type WatchlistData = {
  movies: Movie[];
  shows: (TVShow & { numberOfSeasons: number })[];
  games: GameListItem[];
  channels: LiveChannel[];
  flashGames: FlashGameSummary[];
  progressMap: Record<string, MovieProgress>;
};

/**
 * Just the saved movies, for the My List row on Home and the Movies tab.
 *
 * Separate from getWatchlist because those pages need one row, not the whole
 * page: getWatchlist also reaches gamarr, the Jellyfin channel guide and the
 * Flash library, and making the Movies tab wait on all three to render a
 * poster row would be a poor trade.
 */
export async function getWatchlistMovies(userId: string): Promise<Movie[]> {
  const items = await prisma.watchlistItem.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
  });
  if (items.length === 0) return [];

  const details = await Promise.all(items.map((item) => getMovieById(item.movieId)));
  // Narrowed to NonNullable rather than to Movie: these are MovieDetail, which
  // is a superset, and a predicate has to be assignable to what it narrows.
  return details.filter((m): m is NonNullable<typeof m> => m != null);
}

/** Just the saved shows. Same reasoning as getWatchlistMovies. */
export async function getWatchlistShows(
  userId: string
): Promise<(TVShow & { numberOfSeasons: number })[]> {
  const items = await prisma.watchlistShowItem.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
  });
  if (items.length === 0) return [];

  const details = await Promise.all(items.map((item) => getShowById(item.showId)));
  return details
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({ ...s, numberOfSeasons: s.numberOfSeasons }));
}

/** Loads all saved movies, TV shows, games, live channels, and Flash games;
 *  poster rows scroll horizontally (ScrollableRow) like Home/Movies. */
export async function getWatchlist(userId: string): Promise<WatchlistData> {
  const [movieItems, showItems, gameItems, channelItems, flashItems, allProgress] =
    await Promise.all([
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
      // Same gating reason as gameItems: a Jellyfin round trip for the full
      // channel guide is not worth paying on every My List load for a viewer
      // who has never saved a station.
      prisma.watchlistChannelItem.findMany({
        where: { userId },
        orderBy: { addedAt: "desc" },
        select: { channelId: true },
      }),
      prisma.watchlistFlashGameItem.findMany({
        where: { userId },
        orderBy: { addedAt: "desc" },
        select: { slug: true },
      }),
      prisma.watchProgress.findMany({ where: { userId } }),
    ]);

  const gameKeys = new Set(gameItems.map((i) => i.gameKey));
  const games =
    gameKeys.size > 0
      ? (await getGamesList()).filter((g) => gameKeys.has(g.gameKey))
      : [];

  const channelIds = new Set(channelItems.map((i) => i.channelId));
  const allChannels = channelIds.size > 0 ? await getLiveChannels() : [];
  // Preserves addedAt order (most recently saved first) rather than whatever
  // order the guide returns -- channelIds came from the addedAt-sorted query
  // above, allChannels didn't.
  const channels = channelItems
    .map((i) => allChannels.find((c) => c.id === i.channelId))
    .filter((c): c is LiveChannel => c != null);

  const flashSlugs = new Set(flashItems.map((i) => i.slug));
  const allFlashGames = flashSlugs.size > 0 ? await listFlashGames() : [];
  const flashGames = flashItems
    .map((i) => allFlashGames.find((g) => g.slug === i.slug))
    .filter((g): g is FlashGameSummary => g != null);

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
    channels,
    flashGames,
    progressMap,
  };
}
