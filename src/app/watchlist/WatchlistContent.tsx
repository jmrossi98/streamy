"use client";

import { useState, useCallback } from "react";
import { MovieRow } from "@/components/MovieRow";
import type { MovieProgress } from "@/components/MovieRow";
import { TVRow } from "@/components/TVRow";
import type { Movie, TVShow } from "@/lib/tmdb";

type WatchlistPageResult = {
  movies: Movie[];
  shows: (TVShow & { numberOfSeasons: number })[];
  progressMap: Record<string, MovieProgress>;
  hasMoreMovies: boolean;
  hasMoreShows: boolean;
};

type WatchlistContentProps = {
  initial: WatchlistPageResult;
};

export function WatchlistContent({ initial }: WatchlistContentProps) {
  const [data, setData] = useState<WatchlistPageResult>(initial);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const hasMore = data.hasMoreMovies || data.hasMoreShows;

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/watchlist/items?page=${page + 1}&limit=12`);
      if (!res.ok) throw new Error("Failed to load");
      const next = (await res.json()) as WatchlistPageResult;
      setData((prev) => ({
        movies: [...prev.movies, ...next.movies],
        shows: [...prev.shows, ...next.shows],
        progressMap: { ...prev.progressMap, ...next.progressMap },
        hasMoreMovies: next.hasMoreMovies,
        hasMoreShows: next.hasMoreShows,
      }));
      setPage((p) => p + 1);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, loading, hasMore]);

  const hasAny = data.movies.length > 0 || data.shows.length > 0;

  if (!hasAny) {
    return (
      <p className="text-white/70">
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
      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="px-6 py-2 rounded bg-white/10 text-white font-medium hover:bg-white/20 disabled:opacity-50 transition-colors"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
