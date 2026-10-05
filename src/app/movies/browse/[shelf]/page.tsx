import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getWatchlistMovies } from "@/lib/watchlist";
import { getMovieShelf, getMovieShelfLinks } from "@/lib/browseRows";
import { clampPages, hasMore, parseShelf, shelfHref, shelfSlug } from "@/lib/browseShelfRules";
import { ShelfPage } from "@/components/ShelfPage";
import { MovieShelfGrid } from "@/components/ShelfGrid";

/**
 * Every movie on one shelf, as a grid.
 *
 * A row on /movies shows the first twenty of a genre; its heading leads here
 * for the rest. What a shelf holds is decided in browseRows.ts, alongside the
 * row, so the two cannot disagree.
 */
export const dynamic = "force-dynamic";

export default async function MovieShelfPage({
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
    if (!session?.user?.id) redirect(`/login?callbackUrl=${shelfHref("movies", shelf)}`);
    contents = { title: "My List", items: await getWatchlistMovies(session.user.id), paged: false };
  } else {
    contents = await getMovieShelf(shelf, pages);
    // A genre TMDB does not have, or the holiday shelf out of season.
    if (!contents) notFound();
  }
  const { title, items: movies, paged } = contents;

  const here = shelfSlug(shelf);
  const neighbours = await getMovieShelfLinks();

  return (
    <ShelfPage
      backHref="/movies"
      backLabel="Movies"
      title={title}
      countText={`${movies.length.toLocaleString()} ${movies.length === 1 ? "movie" : "movies"}`}
      emptyText={shelf.kind === "my-list" ? "Nothing saved yet." : "Nothing here yet."}
      isEmpty={movies.length === 0}
      moreHref={hasMore(movies.length, pages, paged) ? `${shelfHref("movies", shelf)}?pages=${pages + 1}` : null}
      others={neighbours
        .filter((n) => shelfSlug(n.shelf) !== here)
        .map((n) => ({ href: shelfHref("movies", n.shelf), label: n.label }))}
    >
      <MovieShelfGrid movies={movies} />
    </ShelfPage>
  );
}
