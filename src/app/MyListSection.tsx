import { getWatchlistMovies, getWatchlistShows } from "@/lib/watchlist";
import { MovieRow } from "@/components/MovieRow";
import { TVRow } from "@/components/TVRow";

/**
 * The viewer's saved titles, below Continue Watching on Home.
 *
 * Resolved inside its own Suspense boundary for the same reason
 * RecentlyWatchedSection is: a saved list is one TMDB detail lookup per item
 * and unbounded in length, so awaiting it in the page body would put the whole
 * shell -- hero included -- behind however many titles this viewer has saved.
 * Here a cold cache costs a moment of skeleton in two strips instead of the
 * page's time to first byte.
 *
 * Movies and shows stay as separate rows rather than merging into one strip
 * the way Continue Watching does: that row merges because "what was I last
 * watching" is one question regardless of kind, whereas a saved list is
 * browsed by kind.
 */
export async function MyListSection({ userId }: { userId: string }) {
  const [movies, shows] = await Promise.all([
    getWatchlistMovies(userId),
    getWatchlistShows(userId),
  ]);

  if (movies.length === 0 && shows.length === 0) return null;

  return (
    <>
      {/* Titled by kind, unlike the tabs where "My List" alone is unambiguous:
          on Home both strips are visible at once, and two rows both called
          "My List" read as one row that broke rather than two kinds. */}
      {movies.length > 0 && <MovieRow title="My List - Movies" movies={movies} />}
      {shows.length > 0 && <TVRow title="My List - Shows" shows={shows} />}
    </>
  );
}

export function MyListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-6 w-28 rounded bg-white/5" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] w-28 shrink-0 rounded bg-white/5 sm:w-32" />
        ))}
      </div>
    </div>
  );
}
