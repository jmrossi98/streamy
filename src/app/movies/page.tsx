import { unstable_noStore } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTrending, getGenres, getDiscoverByGenre, getMovieById } from "@/lib/tmdb";
import { MovieRow } from "@/components/MovieRow";
import type { MovieProgress } from "@/components/MovieRow";

export const dynamic = "force-dynamic";

const MOVIE_GENRE_IDS = [28, 35, 18, 27, 878]; // Action, Comedy, Drama, Horror, Sci-Fi

export default async function MoviesPage() {
  unstable_noStore();
  const session = await getServerSession(authOptions);

  const [trending, genres, allProgress] = await Promise.all([
    getTrending(12),
    getGenres(),
    session?.user?.id
      ? prisma.watchProgress.findMany({ where: { userId: session.user.id } })
      : Promise.resolve([]),
  ]);

  const genreList = genres.filter((g) => MOVIE_GENRE_IDS.includes(g.id));
  const genreRows = await Promise.all(
    genreList.map(async (genre) => ({
      title: genre.name,
      movies: await getDiscoverByGenre(genre.id, 10),
    }))
  );

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
    <main className="min-h-screen pt-24 pb-12">
      <div className="space-y-2 [&>*:first-child]:pt-0">
        <MovieRow title="Trending Now" movies={trending} progressMap={progressMap} />
        {genreRows.map(
          (row) =>
            row.movies.length > 0 && (
              <MovieRow key={row.title} title={row.title} movies={row.movies} progressMap={progressMap} />
            )
        )}
      </div>
    </main>
  );
}
