"use client";

import { MovieRow } from "@/components/MovieRow";
import type { MovieProgress } from "@/components/MovieRow";
import { TVRow } from "@/components/TVRow";
import { GameCard } from "@/components/GameCard";
import { ScrollableRow } from "@/components/ScrollableRow";
import type { Movie, TVShow } from "@/lib/tmdb";
import type { GameListItem } from "@/lib/games";

type WatchlistData = {
  movies: Movie[];
  shows: (TVShow & { numberOfSeasons: number })[];
  games: GameListItem[];
  progressMap: Record<string, MovieProgress>;
};

type WatchlistContentProps = {
  data: WatchlistData;
};

export function WatchlistContent({ data }: WatchlistContentProps) {
  const hasAny = data.movies.length > 0 || data.shows.length > 0 || data.games.length > 0;

  if (!hasAny) {
    return (
      <p className="streamy-page-title-x text-white/70">
        Your watchlist is empty. Add movies and TV shows from their pages using &quot;Add to My List&quot;.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {data.movies.length > 0 && (
        <MovieRow title="Movies" movies={data.movies} progressMap={data.progressMap} />
      )}
      {data.shows.length > 0 && <TVRow title="TV Shows" shows={data.shows} />}
      {data.games.length > 0 && (
        <ScrollableRow title="Games">
          {/* Every game here is, by definition, already in this list -- the
              overlay toggle only ever removes, matching how the equivalent
              movie/show poster button behaves specifically on this page. */}
          {data.games.map((item) => (
            <GameCard key={item.gameKey} item={item} inWatchlist />
          ))}
        </ScrollableRow>
      )}
    </div>
  );
}
