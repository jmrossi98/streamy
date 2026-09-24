import { unstable_noStore } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTrending, getGenres, getDiscoverByGenre, type Movie } from "@/lib/tmdb";
import { getWatchlistMovies } from "@/lib/watchlist";
import { MoviesContent } from "@/components/MoviesContent";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

export const dynamic = "force-dynamic";

const MOVIE_GENRE_IDS = [28, 35, 18, 27, 878]; // Action, Comedy, Drama, Horror, Sci-Fi

export default async function MoviesPage() {
  unstable_noStore();
  const session = await getSession();

  // Single wave only: no getMovieById — client fetches runtimes for progress bars
  const [trending, genres, ...discoverAndProgress] = await Promise.all([
    getTrending(10),
    getGenres(),
    ...MOVIE_GENRE_IDS.map((id) => getDiscoverByGenre(id, 8)),
    session?.user?.id
      ? prisma.watchProgress.findMany({ where: { userId: session.user.id } })
      : Promise.resolve([]),
    // In the same wave rather than after it: the My List row renders above
    // everything else, so making it wait on the genre fan-out would delay the
    // top of the page behind the bottom of it.
    session?.user?.id ? getWatchlistMovies(session.user.id) : Promise.resolve([]),
  ]);

  const allProgress = discoverAndProgress[5] as Awaited<ReturnType<typeof prisma.watchProgress.findMany>>;
  const myList = discoverAndProgress[6] as Movie[];
  const genreRows = MOVIE_GENRE_IDS.map((id, i) => ({
    title: genres.find((g) => g.id === id)?.name ?? "Genre",
    movies: (discoverAndProgress[i] as Awaited<ReturnType<typeof getDiscoverByGenre>>) ?? [],
  }));

  const movieIdsOnPage = new Set([
    ...trending.map((m) => m.id),
    ...genreRows.flatMap((r) => r.movies.map((m) => m.id)),
    // My List too, or a half-watched title shows a progress bar in a genre row
    // and none in the row the viewer actually saved it to.
    ...myList.map((m) => m.id),
  ]);
  const progressList = allProgress
    .filter((p) => movieIdsOnPage.has(String(p.movieId)))
    .slice(0, 50)
    .map((p) => ({ movieId: Number(p.movieId), progressSeconds: p.progressSeconds }));

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <MoviesContent
        trending={trending}
        genreRows={genreRows}
        progressList={progressList}
        myList={myList}
      />
    </div>
  );
}
