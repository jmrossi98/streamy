import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getGenres, getTrendingPages, getDiscoverByGenrePages, type Movie } from "@/lib/tmdb";
import { getWatchlistMovies } from "@/lib/watchlist";
import { getDownloadedMovies } from "@/lib/downloadedLibrary";
import { clampPages, hasMore, parseShelf, shelfHref, shelfSlug, type Shelf } from "@/lib/browseShelfRules";
import { ShelfPage } from "@/components/ShelfPage";
import { MovieShelfGrid } from "@/components/ShelfGrid";

/**
 * Every movie on one shelf, as a grid.
 *
 * A row on /movies shows eight or ten of a genre; its heading leads here for
 * the rest. Trending and genres come from TMDB a page at a time and grow with
 * "Load more"; the viewer's list and the downloaded library are whole.
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

  const genres = await getGenres();
  let title: string;
  let movies: Movie[];
  let paged = false;

  if (shelf.kind === "genre") {
    const genre = genres.find((g) => g.id === shelf.genreId);
    if (!genre) notFound();
    title = genre.name;
    movies = await getDiscoverByGenrePages(shelf.genreId, pages);
    paged = true;
  } else if (shelf.kind === "trending") {
    title = "Trending Now";
    movies = await getTrendingPages(pages);
    paged = true;
  } else if (shelf.kind === "downloaded") {
    title = "Downloaded";
    movies = await getDownloadedMovies();
  } else {
    const session = await getSession();
    if (!session?.user?.id) redirect(`/login?callbackUrl=${shelfHref("movies", shelf)}`);
    title = "My List";
    movies = await getWatchlistMovies(session.user.id);
  }

  const here = shelfSlug(shelf);
  const neighbours: { shelf: Shelf; label: string }[] = [
    { shelf: { kind: "trending" }, label: "Trending Now" },
    { shelf: { kind: "downloaded" }, label: "Downloaded" },
    ...genres.map((g) => ({ shelf: { kind: "genre" as const, genreId: g.id }, label: g.name })),
  ];

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
