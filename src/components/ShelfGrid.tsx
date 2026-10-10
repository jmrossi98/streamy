"use client";

import type { Movie, TVShow } from "@/lib/tmdb";
import type { GameListItem } from "@/lib/games";
import type { FlashGameSummary } from "@/lib/flashGameRules";
import { MovieCard, type MovieProgress } from "@/components/MovieRow";
import { ShowCard } from "@/components/TVRow";
import { GameCard } from "@/components/GameCard";
import { FlashCard } from "@/components/FlashCard";
import { useMemo, useState } from "react";
import { ShelfFilterBar } from "@/components/ShelfFilterBar";
import { filterShelf, shelfGenres, NO_SHELF_FILTER, type ShelfTitle } from "@/lib/shelfFilterRules";

/**
 * A whole shelf as a grid: the same cards the rows use, wrapped instead of
 * scrolled, so a genre can be taken in a screenful at a time.
 *
 * Fewer columns than the ROM grid on purpose. Those are upright box art;
 * these are wide stills with a title underneath, and at eight across the
 * title would be the first thing to go.
 */
const GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/** Upright covers, so the same density as the ROM grid on /games. */
const COVER_GRID_CLASS = "grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";

const describeMovie = (m: Movie): ShelfTitle => ({
  title: m.title,
  year: m.year,
  released: m.releaseDate,
  rating: m.rating,
  genres: m.genres,
});
const describeShow = (s: TVShow): ShelfTitle => ({
  title: s.name,
  year: s.year,
  released: s.releaseDate,
  rating: s.rating,
  genres: s.genres,
});

/**
 * The search/genre/sort bar and what it leaves of the shelf. The grid itself
 * is the caller's, so movies and shows keep their own cards.
 */
function useShelfFilter<T>(items: T[], describe: (item: T) => ShelfTitle, noun: string) {
  const [filter, setFilter] = useState(NO_SHELF_FILTER);
  const genres = useMemo(() => shelfGenres(items, describe), [items, describe]);
  const shown = useMemo(() => filterShelf(items, describe, filter), [items, describe, filter]);
  const bar = (
    <ShelfFilterBar filter={filter} onChange={setFilter} genres={genres} shown={shown.length} total={items.length} noun={noun} />
  );
  const empty = shown.length === 0 ? <p className="py-12 text-sm text-white/50">No {noun} match.</p> : null;
  return { shown, bar, empty };
}

export function MovieShelfGrid({
  movies,
  progressMap = {},
}: {
  movies: Movie[];
  progressMap?: Record<string, MovieProgress>;
}) {
  const { shown, bar, empty } = useShelfFilter(movies, describeMovie, "movies");
  return (
    <>
      {bar}
      {empty}
      <div className={GRID_CLASS}>
        {shown.map((movie) => (
          <MovieCard key={movie.id} movie={movie} progress={progressMap[movie.id]} widthClass="w-full" />
        ))}
      </div>
    </>
  );
}

export function ShowShelfGrid({ shows }: { shows: TVShow[] }) {
  const { shown, bar, empty } = useShelfFilter(shows, describeShow, "shows");
  return (
    <>
      {bar}
      {empty}
      <div className={GRID_CLASS}>
        {shown.map((show) => (
          <ShowCard key={show.id} show={show} widthClass="w-full" />
        ))}
      </div>
    </>
  );
}

/** Saved games. Everything here is in the list by definition, so the toggle only removes. */
export function GameShelfGrid({ games }: { games: GameListItem[] }) {
  return (
    <div className={COVER_GRID_CLASS}>
      {games.map((item) => (
        <GameCard key={item.gameKey} item={item} inWatchlist fixedWidth={false} />
      ))}
    </div>
  );
}

export function FlashShelfGrid({ games }: { games: FlashGameSummary[] }) {
  return (
    <div className={GRID_CLASS}>
      {games.map((game) => (
        <FlashCard key={game.slug} game={game} inList fill />
      ))}
    </div>
  );
}
