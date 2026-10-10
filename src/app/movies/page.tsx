import { unstable_noStore } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pullJellyfinProgressForPage } from "@/lib/progressSync";
import { getWatchlistMovies } from "@/lib/watchlist";
import { MoviesContent } from "@/components/MoviesContent";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";
import { getMovieBrowse } from "@/lib/browseRows";

export const dynamic = "force-dynamic";

export default async function MoviesPage() {
  unstable_noStore();
  const session = await getSession();
  // Roku/Jellyfin progress into Streamy's rows before anything reads them.
  await pullJellyfinProgressForPage(session);

  // Single wave only: no getMovieById — client fetches runtimes for progress bars
  const [browse, allProgress, myList] = await Promise.all([
    getMovieBrowse(),
    session?.user?.id
      ? prisma.watchProgress.findMany({ where: { userId: session.user.id } })
      : Promise.resolve([]),
    // In the same wave rather than after it: the My List row renders above
    // everything else, so making it wait on the rows below would delay the
    // top of the page behind the bottom of it.
    session?.user?.id ? getWatchlistMovies(session.user.id) : Promise.resolve([]),
  ]);

  const movieIdsOnPage = new Set([
    ...browse.trending.map((m) => m.id),
    ...(browse.all?.movies.map((m) => m.id) ?? []),
    ...(browse.holiday?.movies.map((m) => m.id) ?? []),
    ...browse.genreRows.flatMap((r) => r.movies.map((m) => m.id)),
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
        trending={browse.trending}
        holiday={browse.holiday}
        all={browse.all}
        genreRows={browse.genreRows}
        progressList={progressList}
        myList={myList}
      />
    </div>
  );
}
