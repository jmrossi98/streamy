import Image from "next/image";
import Link from "next/link";
import { unstable_noStore } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Hero } from "@/components/Hero";
import { MovieRow } from "@/components/MovieRow";
import { RecentlyWatchedRow } from "@/components/RecentlyWatchedRow";
import type { MovieProgress } from "@/components/MovieRow";
import { getTrending, getGenres, getDiscoverByGenre, getMovieById, getShowById, getTrendingTV } from "@/lib/tmdb";

const HERO_GENRE_IDS = [28, 35, 18, 27, 878]; // Action, Comedy, Drama, Horror, Sci-Fi
const RECENT_LIMIT = 10;

export const dynamic = "force-dynamic";

export default async function HomePage() {
  unstable_noStore();
  const session = await getServerSession(authOptions);

  const [trending, genres, trendingTV, recentProgress, allProgress, recentEpisodeProgress] = await Promise.all([
    getTrending(12),
    getGenres(),
    getTrendingTV(10),
    session?.user?.id
      ? prisma.watchProgress.findMany({
          where: { userId: session.user.id },
          orderBy: { updatedAt: "desc" },
          take: RECENT_LIMIT,
        })
      : Promise.resolve([]),
    session?.user?.id
      ? prisma.watchProgress.findMany({
          where: { userId: session.user.id },
        })
      : Promise.resolve([]),
    session?.user?.id
      ? prisma.episodeProgress.findMany({
          where: { userId: session.user.id },
          orderBy: { updatedAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

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

  const heroGenres = genres.filter((g) => HERO_GENRE_IDS.includes(g.id));
  const genreRows = await Promise.all(
    heroGenres.map(async (genre) => ({
      title: genre.name,
      movies: await getDiscoverByGenre(genre.id, 10),
    }))
  );

  let recentlyWatched: { movie: Awaited<ReturnType<typeof getMovieById>>; progressSeconds: number; runtimeMinutes: number | null }[] = [];
  if (session?.user?.id && recentProgress.length > 0) {
    const details = await Promise.all(
      recentProgress.map((p) => getMovieById(p.movieId))
    );
    recentlyWatched = recentProgress
      .map((p, i) => ({
        movie: details[i],
        progressSeconds: p.progressSeconds,
        runtimeMinutes: details[i]?.runtime ?? null,
      }))
      .filter((item): item is typeof item & { movie: NonNullable<typeof item.movie> } => item.movie != null);
  }

  const recentShowIds = [...new Map(recentEpisodeProgress.map((p) => [p.showId, p])).keys()].slice(0, 6);
  const recentlyWatchedShows = session?.user?.id && recentShowIds.length > 0
    ? (await Promise.all(recentShowIds.map((id) => getShowById(id)))).filter(Boolean) as Awaited<ReturnType<typeof getShowById>>[]
    : [];

  const movieIdsOnPage = new Set([
    ...trending.map((m) => m.id),
    ...genreRows.flatMap((r) => r.movies.map((m) => m.id)),
  ]);
  const progressNeedingRuntime = allProgress.filter((p) => movieIdsOnPage.has(p.movieId));
  const progressDetails = await Promise.all(
    progressNeedingRuntime.map((p) => getMovieById(p.movieId))
  );
  const progressMap: Record<string, MovieProgress> = {};
  progressNeedingRuntime.forEach((p, i) => {
    const detail = progressDetails[i];
    if (detail)
      progressMap[p.movieId] = {
        progressSeconds: p.progressSeconds,
        runtimeMinutes: detail.runtime ?? null,
      };
  });

  return (
    <>
      <Hero featured={featured} />
      <div id="movies" className="space-y-2 [&>*:first-child]:pt-0">
        {session?.user?.id && (
          <RecentlyWatchedRow
            items={recentlyWatched}
            showItems={recentlyWatchedShows.map((show) => ({ show }))}
          />
        )}
        <MovieRow title="Trending Now" movies={trending} progressMap={progressMap} />
        {trendingTV.length > 0 && (
          <section className="px-6 pt-2 pb-2">
            <h2 className="font-display text-2xl md:text-3xl font-bold text-white mb-2">
              Trending TV
            </h2>
            <div className="movie-row">
              {trendingTV.map((show) => (
                <Link
                  key={show.id}
                  href={`/show/${show.id}`}
                  className="movie-card block w-[180px] md:w-[240px] rounded overflow-hidden bg-netflix-dark"
                >
                  <div className="relative aspect-video w-full">
                    <Image
                      src={show.poster}
                      alt={show.name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 180px, 240px"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center text-netflix-black">
                        <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="text-white font-medium text-sm truncate">{show.name}</p>
                    <p className="text-white/60 text-xs">{show.year} · {show.rating}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
        {genreRows.map(
          (row) =>
            row.movies.length > 0 && (
              <MovieRow key={row.title} title={row.title} movies={row.movies} progressMap={progressMap} />
            )
        )}
      </div>
    </>
  );
}
