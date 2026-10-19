import { getSession } from "@/lib/auth";
import { countWatchlist, getWatchlistShows } from "@/lib/watchlist";
import { TVRow } from "@/components/TVRow";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";
import { shelfHref, ROW_WINDOW } from "@/lib/browseShelfRules";
import { getShowBrowse } from "@/lib/browseRows";

export const dynamic = "force-dynamic";

export default async function TVPage() {
  const session = await getSession();
  const [browse, myList, saved] = await Promise.all([
    getShowBrowse(),
    session?.user?.id ? getWatchlistShows(session.user.id, ROW_WINDOW) : Promise.resolve([]),
    session?.user?.id ? countWatchlist(session.user.id) : Promise.resolve(null),
  ]);

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="space-y-2">
        {/* Above Trending: what the viewer chose for themselves outranks what
            is merely popular. Hidden entirely when empty. */}
        {myList.length > 0 && (
          <TVRow title="My List" shows={myList} href={shelfHref("tv", { kind: "my-list" })} total={saved?.shows} />
        )}
        {/* The way into the whole library, kept next to the viewer's own list. */}
        {browse.all && (
          <TVRow title={browse.all.title} shows={browse.all.shows} href={browse.all.href} total={browse.all.total} />
        )}
        {/* Under those: the one row that changes with the
            calendar, so it goes where it will be seen while it is in season. */}
        {browse.holiday && (
          <TVRow
            title={browse.holiday.title}
            shows={browse.holiday.shows}
            href={browse.holiday.href}
            total={browse.holiday.total}
          />
        )}
        <TVRow
          title="Trending TV"
          shows={browse.trending}
          href={shelfHref("tv", { kind: "trending" })}
          total={browse.trendingTotal}
        />
        {browse.rows.map((row) => (
          <TVRow key={row.title} title={row.title} shows={row.shows} href={row.href} total={row.total} />
        ))}
      </div>
    </div>
  );
}
