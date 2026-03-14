import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMovieById, getShowById } from "@/lib/tmdb";
import { MovieRow } from "@/components/MovieRow";
import type { MovieProgress } from "@/components/MovieRow";
import { TVRow } from "@/components/TVRow";
import type { Movie, TVShow } from "@/lib/tmdb";

export default async function WatchlistPage() {
  unstable_noStore();
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?callbackUrl=/watchlist");

  const [movieItems, showItems, allProgress] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId: session.user.id },
      orderBy: { addedAt: "desc" },
    }),
    prisma.watchlistShowItem.findMany({
      where: { userId: session.user.id },
      orderBy: { addedAt: "desc" },
    }),
    prisma.watchProgress.findMany({ where: { userId: session.user.id } }),
  ]);

  const movies: Movie[] = [];
  const progressMap: Record<string, MovieProgress> = {};
  for (const item of movieItems) {
    const m = await getMovieById(item.movieId);
    if (m) {
      movies.push(m);
      const p = allProgress.find((x) => x.movieId === m.id);
      if (p)
        progressMap[m.id] = {
          progressSeconds: p.progressSeconds,
          runtimeMinutes: m.runtime ?? null,
        };
    }
  }

  const shows: TVShow[] = [];
  for (const item of showItems) {
    const s = await getShowById(item.showId);
    if (s) shows.push({ ...s, numberOfSeasons: s.numberOfSeasons });
  }

  const hasAny = movies.length > 0 || shows.length > 0;

  return (
    <div className="pt-24 pb-12 px-6">
      <h1 className="font-display text-4xl font-bold text-white mb-6">My List</h1>
      {!hasAny ? (
        <p className="text-white/70">
          Your watchlist is empty. Add movies and TV shows from their pages using &quot;Add to My List&quot;.
        </p>
      ) : (
        <div className="space-y-2">
          {movies.length > 0 && <MovieRow title="Movies" movies={movies} progressMap={progressMap} />}
          {shows.length > 0 && <TVRow title="TV Shows" shows={shows} />}
        </div>
      )}
    </div>
  );
}
