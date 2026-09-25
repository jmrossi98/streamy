import { getTrendingTV, getTVGenres, getDiscoverTVByGenre } from "@/lib/tmdb";
import { getSession } from "@/lib/auth";
import { getWatchlistShows } from "@/lib/watchlist";
import { TVRow } from "@/components/TVRow";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";
import { Suspense } from "react";
import { DownloadedSection, DownloadedSkeleton } from "../DownloadedSection";

export const dynamic = "force-dynamic";

const TV_ROW_GENRE_LIMIT = 4;
const SHOWS_PER_ROW = 8;

export default async function TVPage() {
  const session = await getSession();
  const [trending, genres, myList] = await Promise.all([
    getTrendingTV(10),
    getTVGenres(),
    session?.user?.id ? getWatchlistShows(session.user.id) : Promise.resolve([]),
  ]);

  const genresForRows = genres.slice(0, TV_ROW_GENRE_LIMIT);
  const genreRows = await Promise.all(
    genresForRows.map((genre) =>
      getDiscoverTVByGenre(genre.id, SHOWS_PER_ROW).then((shows) => ({
        title: genre.name,
        shows,
      }))
    )
  );

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="space-y-2">
        {/* Above Trending: what the viewer chose for themselves outranks what
            is merely popular. Hidden entirely when empty. */}
        {myList.length > 0 && <TVRow title="My List" shows={myList} />}
        {/* Own boundary: this is a TMDB lookup per downloaded show, and the
            rows below it should not wait on the library. */}
        <Suspense fallback={<DownloadedSkeleton />}>
          <DownloadedSection kind="shows" />
        </Suspense>
        <TVRow title="Trending TV" shows={trending} />
        {genreRows.map((row) => (
          <TVRow key={row.title} title={row.title} shows={row.shows} />
        ))}
      </div>
    </div>
  );
}
