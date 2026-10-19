/**
 * Server-only watchlist helpers for the My List page.
 */
import { prisma } from "@/lib/db";
import { getMovieById, getOriginalLanguage, getSeason, getShowById } from "@/lib/tmdb";
import { ANIME, tagAnime } from "@/lib/animeRules";
import { toCardMovie, toCardShow } from "@/lib/cardData";
import type { Movie, TVShow } from "@/lib/tmdb";
import type { MovieProgress } from "@/components/MovieRow";
import { latestEpisodePerShow, type ShowProgress } from "@/lib/showProgressRules";
import { getGamesList, type GameListItem } from "@/lib/games";
import { getLiveChannels, type LiveChannel } from "@/lib/liveTv";
import { listFlashGames } from "@/lib/flashGames";
import type { FlashGameSummary } from "@/lib/flashGameRules";

const showLanguage = (id: string) => getOriginalLanguage("tv", id);

export type WatchlistData = {
  movies: Movie[];
  shows: (TVShow & { numberOfSeasons: number })[];
  /** Saved anime, pulled out of `shows`. Only filled when splitAnime is asked for (the admin's list). */
  anime: (TVShow & { numberOfSeasons: number })[];
  games: GameListItem[];
  channels: LiveChannel[];
  flashGames: FlashGameSummary[];
  progressMap: Record<string, MovieProgress>;
  /** The episode each saved show is partway through, for the tile's red bar. */
  showProgress: Record<string, ShowProgress>;
};

/**
 * Just the saved movies, for the My List row on Home and the Movies tab.
 *
 * Separate from getWatchlist because those pages need one row, not the whole
 * page: getWatchlist also reaches gamarr, the Jellyfin channel guide and the
 * Flash library, and making the Movies tab wait on all three to render a
 * poster row would be a poor trade.
 */
export async function getWatchlistMovies(userId: string, limit?: number): Promise<Movie[]> {
  const items = await prisma.watchlistItem.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
    take: limit,
  });
  if (items.length === 0) return [];

  const details = await Promise.all(items.map((item) => getMovieById(item.movieId)));
  // Narrowed to NonNullable rather than to Movie: these are MovieDetail, which
  // is a superset, and a predicate has to be assignable to what it narrows.
  return details.filter((m): m is NonNullable<typeof m> => m != null).map(toCardMovie);
}

/** One show TMDB won't answer for right now leaves a gap, not an error page. */
function showOrNull(id: string) {
  return getShowById(id).catch(() => null);
}

/** Just the saved shows. Same reasoning as getWatchlistMovies. */
export async function getWatchlistShows(
  userId: string,
  limit?: number
): Promise<(TVShow & { numberOfSeasons: number })[]> {
  const items = await prisma.watchlistShowItem.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
    take: limit,
  });
  if (items.length === 0) return [];

  const details = await Promise.all(items.map((item) => showOrNull(item.showId)));
  return tagAnime(
    details
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map(toCardShow),
    showLanguage
  );
}

/** Loads all saved movies, TV shows, games, live channels, and Flash games;
 *  poster rows scroll horizontally (ScrollableRow) like Home/Movies. */
export async function getWatchlist(
  userId: string,
  {
    splitAnime = false,
    rowLimit,
  }: {
    splitAnime?: boolean;
    /**
     * For the rows page: look up and return only this many of each kind,
     * newest first. The shelf pages leave it unset and get everything.
     * Shows are all looked up when splitting anime, since the split needs
     * each show's genres; only what is returned is cut.
     */
    rowLimit?: number;
  } = {}
): Promise<WatchlistData> {
  const [movieItems, showItems, gameItems, channelItems, flashItems, allProgress, episodeProgress] =
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
      prisma.episodeProgress.findMany({ where: { userId } }),
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
    Promise.all(movieItems.slice(0, rowLimit).map((item) => getMovieById(item.movieId))),
    Promise.all(
      (splitAnime ? showItems : showItems.slice(0, rowLimit)).map((item) => showOrNull(item.showId))
    ),
  ]);

  const movies: Movie[] = [];
  const progressMap: Record<string, MovieProgress> = {};
  movieDetails.forEach((m) => {
    if (m) {
      movies.push(toCardMovie(m));
      const p = allProgress.find((x) => x.movieId === m.id);
      if (p)
        progressMap[m.id] = {
          progressSeconds: p.progressSeconds,
          runtimeMinutes: m.runtime ?? null,
        };
    }
  });

  // Tagged for everyone, so any list's genre filter can offer Anime.
  const allShows = await tagAnime(
    showDetails
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map(toCardShow),
    showLanguage
  );
  const anime = (splitAnime ? allShows.filter((s) => s.genres.includes(ANIME)) : []).slice(0, rowLimit);
  const shows = (splitAnime ? allShows.filter((s) => !s.genres.includes(ANIME)) : allShows).slice(0, rowLimit);

  const savedShowIds = new Set(showItems.map((i) => i.showId));
  const showProgress = await resolveShowProgress(
    latestEpisodePerShow(episodeProgress.filter((p) => savedShowIds.has(p.showId)))
  );

  return {
    movies,
    shows,
    anime,
    games,
    channels,
    flashGames,
    progressMap,
    showProgress,
  };
}

/** Adds each in-progress episode's runtime (from its TMDB season) so the bar has a length. */
async function resolveShowProgress(
  latest: Record<string, { seasonNumber: number; episodeNumber: number; progressSeconds: number }>
): Promise<Record<string, ShowProgress>> {
  const entries = await Promise.all(
    Object.entries(latest).map(async ([showId, p]) => {
      const season = await getSeason(showId, p.seasonNumber).catch(() => null);
      const ep = season?.episodes.find((e) => e.episodeNumber === p.episodeNumber);
      return [showId, { ...p, runtimeMinutes: ep?.runtime ?? null }] as const;
    })
  );
  return Object.fromEntries(entries);
}

/**
 * How many movies and shows a viewer has saved, for the row that shows only
 * the first ROW_WINDOW of them and offers the rest at its end.
 */
export async function countWatchlist(userId: string): Promise<{ movies: number; shows: number }> {
  const [movies, shows] = await Promise.all([
    prisma.watchlistItem.count({ where: { userId } }),
    prisma.watchlistShowItem.count({ where: { userId } }),
  ]);
  return { movies, shows };
}
