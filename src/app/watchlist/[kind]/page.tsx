import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getWatchlist } from "@/lib/watchlist";
import { ShelfPage } from "@/components/ShelfPage";
import { FlashShelfGrid, GameShelfGrid, MovieShelfGrid, ShowShelfGrid } from "@/components/ShelfGrid";
import { WATCHLIST_SHELVES, watchlistShelfHref, type WatchlistShelf } from "@/lib/browseShelfRules";

/**
 * One kind of saved title as a grid: the whole of a My List row.
 *
 * The rows on /watchlist scroll sideways; a list someone has been adding to
 * for a year is easier to look over all at once. Live TV has no page here --
 * it is already laid out as a grid on /watchlist itself.
 */
export const dynamic = "force-dynamic";

function isShelf(kind: string): kind is WatchlistShelf {
  return (WATCHLIST_SHELVES as readonly string[]).includes(kind);
}

export default async function WatchlistShelfPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isShelf(kind)) notFound();
  const session = await getSession();
  if (!session?.user?.id) redirect(`/login?callbackUrl=${watchlistShelfHref(kind)}`);

  const data = await getWatchlist(session.user.id);
  const shelves: Record<WatchlistShelf, { title: string; count: number; noun: [string, string] }> = {
    movies: { title: "Movies", count: data.movies.length, noun: ["movie", "movies"] },
    shows: { title: "TV Shows", count: data.shows.length, noun: ["show", "shows"] },
    games: { title: "Games", count: data.games.length, noun: ["game", "games"] },
    flash: { title: "Flash Games", count: data.flashGames.length, noun: ["game", "games"] },
  };
  const here = shelves[kind];

  return (
    <ShelfPage
      backHref="/watchlist"
      backLabel="My List"
      title={here.title}
      countText={`${here.count.toLocaleString()} ${here.count === 1 ? here.noun[0] : here.noun[1]}`}
      emptyText="Nothing saved here yet."
      isEmpty={here.count === 0}
      moreHref={null}
      // Only the kinds that have something in them: a link to an empty shelf
      // is a dead end.
      others={WATCHLIST_SHELVES.filter((k) => k !== kind && shelves[k].count > 0).map((k) => ({
        href: watchlistShelfHref(k),
        label: shelves[k].title,
      }))}
    >
      {kind === "movies" && <MovieShelfGrid movies={data.movies} progressMap={data.progressMap} />}
      {kind === "shows" && <ShowShelfGrid shows={data.shows} />}
      {kind === "games" && <GameShelfGrid games={data.games} />}
      {kind === "flash" && <FlashShelfGrid games={data.flashGames} />}
    </ShelfPage>
  );
}
