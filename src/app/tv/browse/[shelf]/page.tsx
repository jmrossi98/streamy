import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getWatchlistShows } from "@/lib/watchlist";
import { getShowShelf, getShowShelfLinks } from "@/lib/browseRows";
import { clampPages, hasMore, parseShelf, shelfHref, shelfSlug } from "@/lib/browseShelfRules";
import { ShelfPage } from "@/components/ShelfPage";
import { ShowShelfGrid } from "@/components/ShelfGrid";

/** Every show on one shelf, as a grid -- the TV twin of /movies/browse/[shelf]. */
export const dynamic = "force-dynamic";

export default async function ShowShelfPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams?: Promise<{ pages?: string }>;
}) {
  const { shelf: slug } = await params;
  const shelf = parseShelf(slug);
  if (!shelf) notFound();
  const pages = clampPages((await searchParams)?.pages);

  let contents;
  if (shelf.kind === "my-list") {
    const session = await getSession();
    if (!session?.user?.id) redirect(`/login?callbackUrl=${shelfHref("tv", shelf)}`);
    contents = { title: "My List", items: await getWatchlistShows(session.user.id), paged: false };
  } else {
    contents = await getShowShelf(shelf, pages);
    // A genre TMDB does not have, or the holiday shelf out of season.
    if (!contents) notFound();
  }
  const { title, items: shows, paged } = contents;

  const here = shelfSlug(shelf);
  const neighbours = await getShowShelfLinks();

  return (
    <ShelfPage
      backHref="/tv"
      backLabel="TV Shows"
      title={title}
      countText={`${shows.length.toLocaleString()} ${shows.length === 1 ? "show" : "shows"}`}
      emptyText={shelf.kind === "my-list" ? "Nothing saved yet." : "Nothing here yet."}
      isEmpty={shows.length === 0}
      moreHref={hasMore(shows.length, pages, paged) ? `${shelfHref("tv", shelf)}?pages=${pages + 1}` : null}
      others={neighbours
        .filter((n) => shelfSlug(n.shelf) !== here)
        .map((n) => ({ href: shelfHref("tv", n.shelf), label: n.label }))}
    >
      <ShowShelfGrid shows={shows} />
    </ShelfPage>
  );
}
