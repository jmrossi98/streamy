import { countWatchlist, getWatchlistRecent } from "@/lib/watchlist";
import { MixedRow } from "@/components/MixedRow";
import { ROW_WINDOW } from "@/lib/browseShelfRules";

/** The full My List page: every kind, as grids. */
const MY_LIST_HREF = "/watchlist";

/**
 * The viewer's saved titles, below Continue Watching on Home.
 *
 * Resolved inside its own Suspense boundary for the same reason
 * RecentlyWatchedSection is: a saved list is one TMDB detail lookup per item
 * and unbounded in length, so awaiting it in the page body would put the whole
 * shell -- hero included -- behind however many titles this viewer has saved.
 * Here a cold cache costs a moment of skeleton in one strip instead of the
 * page's time to first byte.
 *
 * One strip, movies and shows together, newest save first -- the way Continue
 * Watching mixes kinds by when they were last watched. Home used to show two
 * rows by kind; Jake asked for one (2026-10-19). The Movies and TV tabs keep
 * their single-kind My List rows, since there the kind is the page.
 */
export async function MyListSection({ userId }: { userId: string }) {
  const [items, saved] = await Promise.all([getWatchlistRecent(userId, ROW_WINDOW), countWatchlist(userId)]);
  if (items.length === 0) return null;
  return <MixedRow title="My List" items={items} href={MY_LIST_HREF} total={saved.movies + saved.shows} />;
}

export function MyListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-6 w-28 rounded bg-white/5" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-video w-40 shrink-0 rounded bg-white/5 sm:w-44 md:w-60" />
        ))}
      </div>
    </div>
  );
}
