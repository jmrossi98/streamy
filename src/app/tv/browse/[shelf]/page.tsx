import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getTVGenres, getTrendingTVPages, getDiscoverTVByGenrePages, type TVShow } from "@/lib/tmdb";
import { getWatchlistShows } from "@/lib/watchlist";
import { getDownloadedShows } from "@/lib/downloadedLibrary";
import { clampPages, hasMore, parseShelf, shelfHref, shelfSlug, type Shelf } from "@/lib/browseShelfRules";
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

  const genres = await getTVGenres();
  let title: string;
  let shows: TVShow[];
  let paged = false;

  if (shelf.kind === "genre") {
    const genre = genres.find((g) => g.id === shelf.genreId);
    if (!genre) notFound();
    title = genre.name;
    shows = await getDiscoverTVByGenrePages(shelf.genreId, pages);
    paged = true;
  } else if (shelf.kind === "trending") {
    title = "Trending TV";
    shows = await getTrendingTVPages(pages);
    paged = true;
  } else if (shelf.kind === "downloaded") {
    title = "Downloaded";
    shows = await getDownloadedShows();
  } else {
    const session = await getSession();
    if (!session?.user?.id) redirect(`/login?callbackUrl=${shelfHref("tv", shelf)}`);
    title = "My List";
    shows = await getWatchlistShows(session.user.id);
  }

  const here = shelfSlug(shelf);
  const neighbours: { shelf: Shelf; label: string }[] = [
    { shelf: { kind: "trending" }, label: "Trending TV" },
    { shelf: { kind: "downloaded" }, label: "Downloaded" },
    ...genres.map((g) => ({ shelf: { kind: "genre" as const, genreId: g.id }, label: g.name })),
  ];

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
