import { getSession } from "@/lib/auth";
import { getWatchlistShows } from "@/lib/watchlist";
import { TVRow } from "@/components/TVRow";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";
import { shelfHref } from "@/lib/browseShelfRules";
import { getShowBrowse } from "@/lib/browseRows";

export const dynamic = "force-dynamic";

export default async function TVPage() {
  const session = await getSession();
  const [browse, myList] = await Promise.all([
    getShowBrowse(),
    session?.user?.id ? getWatchlistShows(session.user.id) : Promise.resolve([]),
  ]);

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="space-y-2">
        {/* Above Trending: what the viewer chose for themselves outranks what
            is merely popular. Hidden entirely when empty. */}
        {myList.length > 0 && <TVRow title="My List" shows={myList} href={shelfHref("tv", { kind: "my-list" })} />}
        {/* Directly under My List: the one row that changes with the
            calendar, so it goes where it will be seen while it is in season. */}
        {browse.holiday && (
          <TVRow title={browse.holiday.title} shows={browse.holiday.shows} href={browse.holiday.href} />
        )}
        <TVRow title="Trending TV" shows={browse.trending} href={shelfHref("tv", { kind: "trending" })} />
        {browse.genreRows.map((row) => (
          <TVRow key={row.title} title={row.title} shows={row.shows} href={row.href} />
        ))}
      </div>
    </div>
  );
}
