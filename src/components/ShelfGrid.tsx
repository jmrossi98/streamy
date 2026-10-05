"use client";

import type { Movie, TVShow } from "@/lib/tmdb";
import { MovieCard } from "@/components/MovieRow";
import { ShowCard } from "@/components/TVRow";

/**
 * A whole shelf as a grid: the same cards the rows use, wrapped instead of
 * scrolled, so a genre can be taken in a screenful at a time.
 *
 * Fewer columns than the ROM grid on purpose. Those are upright box art;
 * these are wide stills with a title underneath, and at eight across the
 * title would be the first thing to go.
 */
const GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

export function MovieShelfGrid({ movies }: { movies: Movie[] }) {
  return (
    <div className={GRID_CLASS}>
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} widthClass="w-full" />
      ))}
    </div>
  );
}

export function ShowShelfGrid({ shows }: { shows: TVShow[] }) {
  return (
    <div className={GRID_CLASS}>
      {shows.map((show) => (
        <ShowCard key={show.id} show={show} widthClass="w-full" />
      ))}
    </div>
  );
}
