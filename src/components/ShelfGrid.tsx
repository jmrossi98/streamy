"use client";

import type { Movie, TVShow } from "@/lib/tmdb";
import type { GameListItem } from "@/lib/games";
import type { FlashGameSummary } from "@/lib/flashGameRules";
import { MovieCard, type MovieProgress } from "@/components/MovieRow";
import { ShowCard } from "@/components/TVRow";
import { GameCard } from "@/components/GameCard";
import { FlashCard } from "@/components/FlashCard";

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

export function MovieShelfGrid({
  movies,
  progressMap = {},
}: {
  movies: Movie[];
  progressMap?: Record<string, MovieProgress>;
}) {
  return (
    <div className={GRID_CLASS}>
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} progress={progressMap[movie.id]} widthClass="w-full" />
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
