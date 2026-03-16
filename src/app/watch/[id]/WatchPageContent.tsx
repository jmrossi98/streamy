"use client";

import { useState, useEffect } from "react";
import type { Movie, MovieDetail } from "@/lib/tmdb";
import { getMovieFromCache, setMovieInCache } from "@/lib/movieCache";
import { InfoHero } from "@/components/InfoHero";
import { WatchlistButton } from "@/components/WatchlistButton";

const FALLBACK_BACKDROP = "https://placehold.co/1920x1080/1a1a1a/444?text=No+Backdrop";

type Props = { id: string; initialInList: boolean; progressSeconds?: number };

export function WatchPageContent({ id, initialInList, progressSeconds = 0 }: Props) {
  const cached = getMovieFromCache(id);
  const [movie, setMovie] = useState<MovieDetail | Movie | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/movies/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((full: MovieDetail | null) => {
        if (!cancelled && full) {
          setMovie(full);
          setMovieInCache(id, full);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading && !movie) {
    return (
      <div className="min-h-screen bg-netflix-black pt-24 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="min-h-screen bg-netflix-black pt-24 flex items-center justify-center">
        <p className="text-white/80">Movie not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-netflix-black pt-16 pb-12">
      <InfoHero
        backdropUrl={movie.backdrop || movie.poster || FALLBACK_BACKDROP}
        title={movie.title || "Untitled"}
        addToMyListNode={
          <WatchlistButton
            movieId={movie.id}
            initialInList={initialInList}
          />
        }
        playHref={`/watch/${id}/play`}
        playLabel={progressSeconds > 0 ? "Resume" : "Watch now"}
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10 text-center md:text-left">
        <p className="text-white/80 text-lg">{movie.overview}</p>
        <div className="mt-4 flex flex-wrap gap-4 text-white/70 justify-center md:justify-start">
          {movie.year && <span>{movie.year}</span>}
          {movie.duration && <span>{movie.duration}</span>}
          <span className="text-green-400 font-medium">{movie.rating} Rating</span>
        </div>
        {movie.genres.length > 0 && (
          <div className="mt-4 flex gap-2 flex-wrap justify-center md:justify-start">
            {movie.genres.map((g) => (
              <span
                key={g}
                className="px-3 py-1 rounded bg-white/10 text-sm text-white/90"
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
