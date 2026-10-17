"use client";

import { MovieRow } from "@/components/MovieRow";
import type { MovieProgress } from "@/components/MovieRow";
import type { ShowProgress } from "@/lib/showProgressRules";
import { TVRow } from "@/components/TVRow";
import { GameCard } from "@/components/GameCard";
import { FlashCard } from "@/components/FlashCard";
import { ChannelCard } from "@/components/ChannelCard";
import { ScrollableRow } from "@/components/ScrollableRow";
import type { Movie, TVShow } from "@/lib/tmdb";
import type { GameListItem } from "@/lib/games";
import type { LiveChannel } from "@/lib/liveTv";
import type { FlashGameSummary } from "@/lib/flashGameRules";
import { watchlistShelfHref } from "@/lib/browseShelfRules";
import { useWatchlist } from "@/contexts/WatchlistContext";

type WatchlistData = {
  movies: Movie[];
  shows: (TVShow & { numberOfSeasons: number })[];
  anime: (TVShow & { numberOfSeasons: number })[];
  games: GameListItem[];
  channels: LiveChannel[];
  flashGames: FlashGameSummary[];
  progressMap: Record<string, MovieProgress>;
  showProgress: Record<string, ShowProgress>;
};

type WatchlistContentProps = {
  data: WatchlistData;
};

export function WatchlistContent({ data: server }: WatchlistContentProps) {
  // A removal takes the tile off right away, from the shared My List state,
  // instead of waiting on a re-render of the whole page from the server.
  // Both sets empty means that state failed to load, not that the list is
  // empty, so the server's list stands.
  const { movieIds, showIds } = useWatchlist();
  const live = movieIds.size > 0 || showIds.size > 0;
  const data = live
    ? {
        ...server,
        movies: server.movies.filter((m) => movieIds.has(String(m.id))),
        shows: server.shows.filter((s) => showIds.has(String(s.id))),
        anime: server.anime.filter((s) => showIds.has(String(s.id))),
      }
    : server;
  const hasAny =
    data.movies.length > 0 ||
    data.shows.length > 0 ||
    data.anime.length > 0 ||
    data.games.length > 0 ||
    data.channels.length > 0 ||
    data.flashGames.length > 0;

  if (!hasAny) {
    return (
      <p className="streamy-page-title-x text-white/70">
        Your watchlist is empty. Add movies, TV shows, live channels, and games from their
        pages using &quot;Add to My List&quot;.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {data.movies.length > 0 && (
        <MovieRow
          title="Movies"
          movies={data.movies}
          progressMap={data.progressMap}
          href={watchlistShelfHref("movies")}
        />
      )}
      {data.shows.length > 0 && <TVRow title="TV Shows" shows={data.shows} progressMap={data.showProgress} href={watchlistShelfHref("shows")} />}
      {data.anime.length > 0 && <TVRow title="Anime" shows={data.anime} progressMap={data.showProgress} href={watchlistShelfHref("anime")} />}
      {data.channels.length > 0 && (
        // A vertical list, like /live's own "My Stations" section, rather
        // than a horizontal poster row -- a channel card is a wide list item
        // with a logo and what's on now, not artwork to browse by, so it
        // reads the same way here as it does on the page it was saved from.
        <section className="px-4 py-6 md:px-6">
          <h2 className="mb-3 font-display text-xl font-bold text-white">Live TV</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.channels.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} inList />
            ))}
          </div>
        </section>
      )}
      {data.games.length > 0 && (
        <ScrollableRow title="Games" href={watchlistShelfHref("games")}>
          {/* Every game here is, by definition, already in this list -- the
              overlay toggle only ever removes, matching how the equivalent
              movie/show poster button behaves specifically on this page. */}
          {data.games.map((item) => (
            <GameCard key={item.gameKey} item={item} inWatchlist />
          ))}
        </ScrollableRow>
      )}
      {data.flashGames.length > 0 && (
        <ScrollableRow title="Flash Games" href={watchlistShelfHref("flash")}>
          {data.flashGames.map((game) => (
            <FlashCard key={game.slug} game={game} inList />
          ))}
        </ScrollableRow>
      )}
    </div>
  );
}
