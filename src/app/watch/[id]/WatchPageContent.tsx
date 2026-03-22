"use client";

import { useState, useEffect } from "react";
import type { Movie, MovieDetail } from "@/lib/tmdb";
import { getMovieFromCache, setMovieInCache } from "@/lib/movieCache";
import { InfoHero } from "@/components/InfoHero";
import { WatchlistButton } from "@/components/WatchlistButton";

const FALLBACK_BACKDROP = "https://placehold.co/1920x1080/1a1a1a/444?text=No+Backdrop";

type Props = { id: string; initialInList: boolean; progressSeconds?: number };

function buildMetaLine(movie: Movie | MovieDetail): string {
  const parts: string[] = [];
  if (movie.year) parts.push(movie.year);
  if (movie.duration) parts.push(movie.duration);
  if (movie.genres.length > 0) {
    parts.push(movie.genres.slice(0, 3).join(", "));
  }
  return parts.join(" · ");
}

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
      <div className="flex min-h-screen items-center justify-center bg-netflix-black pt-24">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-netflix-black pt-24">
        <p className="text-white/80">Movie not found.</p>
      </div>
    );
  }

  const metaLine = buildMetaLine(movie);

  const badgeNodes = (
    <>
      <span className="rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white/90">
        HD
      </span>
      <span className="rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/90">
        {movie.rating.toFixed(1)} ★
      </span>
    </>
  );

  const listMobile = (
    <WatchlistButton movieId={movie.id} initialInList={initialInList} variant="circle" compact />
  );
  const listDesktop = <WatchlistButton movieId={movie.id} initialInList={initialInList} />;

  return (
    <div className="min-h-screen bg-black pb-16 pt-16 md:bg-netflix-black md:pb-12">
      <InfoHero
        backdropUrl={movie.backdrop || movie.poster || FALLBACK_BACKDROP}
        title={movie.title || "Untitled"}
        metaLine={metaLine}
        badgeNodes={badgeNodes}
        addToMyListMobile={listMobile}
        addToMyListDesktop={listDesktop}
        playHref={`/watch/${id}/play`}
        playLabel={progressSeconds > 0 ? "Resume" : "Watch now"}
      />

      {/* Desktop: original body (no streaming-style synopsis header) */}
      <div className="mx-auto hidden max-w-4xl px-4 py-8 text-center sm:px-6 sm:py-10 md:block md:text-left">
        <p className="text-lg text-white/80">{movie.overview}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-4 text-white/70 md:justify-start">
          {movie.year && <span>{movie.year}</span>}
          {movie.duration && <span>{movie.duration}</span>}
          <span className="font-medium text-green-400">{movie.rating} Rating</span>
        </div>
        {movie.genres.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
            {movie.genres.map((g) => (
              <span key={g} className="rounded bg-white/10 px-3 py-1 text-sm text-white/90">
                {g}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Mobile: anchor + synopsis label + genres */}
      <div
        id="details"
        className="mx-auto max-w-4xl scroll-mt-28 px-4 py-10 text-left md:hidden sm:px-6"
      >
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Synopsis</h2>
        <p className="text-base leading-relaxed text-white/85 sm:text-lg">{movie.overview}</p>
        {movie.genres.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {movie.genres.map((g) => (
              <span
                key={g}
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white/85"
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
