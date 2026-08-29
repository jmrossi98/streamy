import { unstable_noStore } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { Hero } from "@/components/Hero";
import { HomeFeedHeader } from "@/components/HomeFeedHeader";
import { RecentlyWatchedRow, type RecentItem } from "@/components/RecentlyWatchedRow";
import { HomeMoviesSection } from "@/components/HomeMoviesSection";
import { HomePrefetch } from "@/components/HomePrefetch";
import { getTrending, getGenres, getDiscoverByGenre, getMovieById, getShowById, getTrendingTV, getTVGenres, getDiscoverTVByGenre } from "@/lib/tmdb";

const HERO_GENRE_IDS = [28, 35, 18, 27, 878]; // Action, Comedy, Drama, Horror, Sci-Fi
const RECENT_LIMIT = 3; // cap to keep server fast; progress bars for rows fetched client-side
const RECENT_SHOWS_LIMIT = 3;
const TV_CACHE_WARM_GENRES = 0; // skip on home to keep TTFB low; TV tab warms on first visit
const EPISODE_PROGRESS_TAKE = 30;

export const dynamic = "force-dynamic";

export default async function HomePage() {
  unstable_noStore();
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/who-is-watching");
  }

  // Single wave: all list data + hero genre rows (no second round-trip for genre discover)
  const [
    trending,
    genres,
    ...heroDiscoverResults
  ] = await Promise.all([
    getTrending(10),
    getGenres(),
    ...HERO_GENRE_IDS.map((id) => getDiscoverByGenre(id, 8)),
    getTrendingTV(10),
    prisma.watchProgress.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.episodeProgress.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      take: EPISODE_PROGRESS_TAKE,
    }),
    getTVGenres().then((tvGenres) =>
      Promise.all(tvGenres.slice(0, TV_CACHE_WARM_GENRES).map((g) => getDiscoverTVByGenre(g.id, 8)))
    ),
  ]);

  const trendingTV = heroDiscoverResults[5] as Awaited<ReturnType<typeof getTrendingTV>>;
  const allWatchProgress = heroDiscoverResults[6] as Awaited<ReturnType<typeof prisma.watchProgress.findMany>>;
  const recentEpisodeProgress = heroDiscoverResults[7] as Awaited<ReturnType<typeof prisma.episodeProgress.findMany>>;

  const genreRows = HERO_GENRE_IDS.slice(0, 5).map((id, i) => ({
    title: genres.find((g) => g.id === id)?.name ?? "Genre",
    movies: (heroDiscoverResults[i] as Awaited<ReturnType<typeof getDiscoverByGenre>>) ?? [],
  }));

  const recentProgress = allWatchProgress.slice(0, RECENT_LIMIT);
  const recentShowIds = Array.from(new Map(recentEpisodeProgress.map((p) => [p.showId, p])).keys()).slice(0, RECENT_SHOWS_LIMIT);

  // Only fetch details for recently-watched strip (3 movies + 3 shows); progress bars for rows = client-side
  const [movieDetails, ...showDetails] = await Promise.all([
    Promise.all(recentProgress.map((p) => getMovieById(String(p.movieId)))),
    ...recentShowIds.map((id) => getShowById(id)),
  ]);
  // Movies and shows merged into one strip ordered by when each was last
  // watched (newest first), so a show watched minutes ago outranks an older
  // movie -- the "Continue Watching" ordering people expect.
  const recentMovieItems: RecentItem[] = recentProgress
    .map((p, i): RecentItem | null => {
      const movie = movieDetails[i];
      if (!movie) return null;
      return {
        kind: "movie",
        sortAt: new Date(p.updatedAt).getTime(),
        movie,
        progressSeconds: p.progressSeconds,
        runtimeMinutes: movie.runtime ?? null,
      };
    })
    .filter((item): item is RecentItem => item != null);
  const recentShowItems: RecentItem[] = recentShowIds
    .map((id, i): RecentItem | null => {
      const show = showDetails[i];
      if (!show) return null;
      const lastWatched = recentEpisodeProgress.find((p) => p.showId === id)?.updatedAt;
      return { kind: "show", sortAt: lastWatched ? new Date(lastWatched).getTime() : 0, show };
    })
    .filter((item): item is RecentItem => item != null);
  const recentlyWatchedItems = [...recentMovieItems, ...recentShowItems].sort(
    (a, b) => b.sortAt - a.sortAt
  );

  const movieIdsOnPage = new Set([
    ...trending.map((m) => m.id),
    ...genreRows.flatMap((r) => r.movies.map((m) => m.id)),
  ]);
  const progressList = allWatchProgress
    .filter((p) => movieIdsOnPage.has(String(p.movieId)))
    .slice(0, 50)
    .map((p) => ({ movieId: Number(p.movieId), progressSeconds: p.progressSeconds }));

  const featured = trending[0];
  if (!featured) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <p className="text-white/80 text-center max-w-md">
          No trending movies loaded. Check that TMDB_API_KEY is set in your environment.
        </p>
      </div>
    );
  }

  const hasRecentProgress = recentlyWatchedItems.length > 0;
  const featuredProgressSeconds =
    allWatchProgress.find((p) => String(p.movieId) === String(featured.id))?.progressSeconds ?? 0;

  const prefetchIds = Array.from(
    new Set([
      String(featured.id),
      ...trending.slice(0, 5).map((m) => String(m.id)),
      ...(genreRows[0]?.movies.slice(0, 4).map((m) => String(m.id)) ?? []),
    ])
  );
  const prefetchShowIds = trendingTV.slice(0, 6).map((s) => String(s.id));
  const runtimeIds = progressList.map((p) => String(p.movieId));

  return (
    <>
      <HomePrefetch movieIds={prefetchIds} showIds={prefetchShowIds} runtimeIds={runtimeIds} />
      <div className="max-md:pt-[calc(4rem+env(safe-area-inset-top,0px))]">
        <HomeFeedHeader />
        <Hero featured={featured} progressSeconds={featuredProgressSeconds} />
      </div>
      <div id="movies" className="space-y-4 pt-6 sm:space-y-5 md:space-y-2 md:pt-5">
        {hasRecentProgress && (
          <RecentlyWatchedRow items={recentlyWatchedItems} />
        )}
        <HomeMoviesSection
          trending={trending}
          genreRows={genreRows}
          trendingTV={trendingTV}
          progressList={progressList}
        />
      </div>
    </>
  );
}
