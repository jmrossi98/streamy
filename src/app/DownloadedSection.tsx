import { getDownloadedMovies, getDownloadedShows } from "@/lib/downloadedLibrary";
import { MovieRow } from "@/components/MovieRow";
import { TVRow } from "@/components/TVRow";

/**
 * What is on disk right now, as rows.
 *
 * Its own Suspense boundary for the same reason MyListSection has one: this
 * is one TMDB detail lookup per title, so awaiting it in the page body would
 * put the hero behind however much of the library has been downloaded.
 *
 * Placed below My List rather than above it. A saved list is a statement of
 * intent and is short; the downloaded library only grows, so putting it first
 * would push everything the viewer chose further down every week.
 *
 * `kind` exists because the tab pages want only their own half. Home wants
 * both, and gets them as two strips for the same reason My List does -- a
 * downloaded library is browsed by kind.
 */
export async function DownloadedSection({ kind = "both" }: { kind?: "movies" | "shows" | "both" }) {
  const [movies, shows] = await Promise.all([
    kind === "shows" ? Promise.resolve([]) : getDownloadedMovies(),
    kind === "movies" ? Promise.resolve([]) : getDownloadedShows(),
  ]);

  if (movies.length === 0 && shows.length === 0) return null;

  // "Downloaded" over "Available": available is what a streaming service says
  // about something it is licensed to show you, which is the opposite of the
  // distinction this row exists to draw.
  const movieTitle = kind === "movies" ? "Downloaded" : "Downloaded - Movies";
  const showTitle = kind === "shows" ? "Downloaded" : "Downloaded - Shows";

  return (
    <>
      {movies.length > 0 && <MovieRow title={movieTitle} movies={movies} />}
      {shows.length > 0 && <TVRow title={showTitle} shows={shows} />}
    </>
  );
}

export function DownloadedSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-6 w-36 rounded bg-white/5" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] w-28 shrink-0 rounded bg-white/5 sm:w-32" />
        ))}
      </div>
    </div>
  );
}
