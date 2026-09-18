import { Suspense } from "react";
import { unstable_noStore } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { Hero } from "@/components/Hero";
import { HomeFeedHeader } from "@/components/HomeFeedHeader";
import { HomeMoviesSection } from "@/components/HomeMoviesSection";
import { HomePrefetch } from "@/components/HomePrefetch";
import { RecentlyWatchedSection, RecentlyWatchedSkeleton } from "./RecentlyWatchedSection";
import { getTrending, getGenres, getDiscoverByGenre, getTrendingTV } from "@/lib/tmdb";

const HERO_GENRE_IDS = [28, 35, 18, 27, 878]; // Action, Comedy, Drama, Horror, Sci-Fi
const RECENT_LIMIT = 3; // cap to keep server fast; progress bars for rows fetched client-side
const RECENT_SHOWS_LIMIT = 3;
// TV_CACHE_WARM_GENRES is gone along with the call it guarded. It was already
// 0 ("skip on home to keep TTFB low"), so the getTVGenres().then(...) entry in
// the wave below sliced that list to nothing and threw the result away -- a
// TMDB call on the critical path of every home render whose only remaining
// effect was warming its own cache. The TV tab warms it on first visit anyway.
const EPISODE_PROGRESS_TAKE = 30;

export const dynamic = "force-dynamic";

export default async function HomePage() {
  unstable_noStore();
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/who-is-watching");
  }

  // Single wave: everything the shell, the hero and every row needs.
  //
  // The genre lists are one nested Promise.all rather than spread into this
  // one. Spread, the results landed in a rest array that the three values
  // after them had to be dug back out of by index -- `heroDiscoverResults[6]`
  // with an `as` cast, because TypeScript cannot know what is at position six
  // of a spread. Adding a single genre to HERO_GENRE_IDS shifted all three by
  // one and the casts would have kept it compiling: watch progress read as
  // trending TV, silently, at runtime only.
  const [trending, genres, genreMovieLists, trendingTV, allWatchProgress, recentEpisodeProgress] =
    await Promise.all([
      getTrending(10),
      getGenres(),
      Promise.all(HERO_GENRE_IDS.map((id) => getDiscoverByGenre(id, 8))),
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
    ]);

  const genreRows = HERO_GENRE_IDS.map((id, i) => ({
    title: genres.find((g) => g.id === id)?.name ?? "Genre",
    movies: genreMovieLists[i] ?? [],
  }));

  const recentProgress = allWatchProgress.slice(0, RECENT_LIMIT);
  const recentShowIds = Array.from(new Map(recentEpisodeProgress.map((p) => [p.showId, p])).keys()).slice(0, RECENT_SHOWS_LIMIT);

  // The detail lookups for the strip (3 movies + 3 shows) used to be a second
  // await right here, and nothing rendered until they finished. They now live
  // in RecentlyWatchedSection behind a Suspense boundary, so the shell, the
  // hero and every row flush on wave one above and the strip streams in.

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

  // Whether there is anything to continue is knowable from the progress rows
  // wave one already returned -- no detail lookup needed. That matters: it
  // decides whether to reserve the strip's space before the section behind the
  // Suspense boundary has resolved, so a viewer with nothing saved never sees
  // a skeleton for a row that will turn out to be empty.
  const hasRecentProgress = recentProgress.length > 0 || recentShowIds.length > 0;
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
          <Suspense fallback={<RecentlyWatchedSkeleton />}>
            <RecentlyWatchedSection
              recentProgress={recentProgress}
              recentShowIds={recentShowIds}
              recentEpisodeProgress={recentEpisodeProgress}
            />
          </Suspense>
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
