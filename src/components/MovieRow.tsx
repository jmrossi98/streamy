"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useHoverPrefetch } from "@/lib/useHoverPrefetch";
import type { Movie } from "@/lib/tmdb";
import { CardArt } from "@/components/CardArt";
import { ScrollableRow } from "@/components/ScrollableRow";
import { PosterActions } from "@/components/PosterActions";
import { setMovieInCache } from "@/lib/movieCache";
import { rowWindow } from "@/lib/browseShelfRules";

/** Warm movie cache on hover so /watch/[id] play loads fast when they click. */
function prefetchMovie(id: string) {
  fetch(`/api/movies/${id}`).catch(() => {});
}

export type MovieProgress = { progressSeconds: number; runtimeMinutes: number | null };

type MovieRowProps = {
  title: string;
  movies: Movie[];
  progressMap?: Record<string, MovieProgress>;
  /** The full shelf this row is a window onto; makes the heading a link to it. */
  href?: string;
};

function progressPercent(progressSeconds: number, runtimeMinutes: number | null): number {
  if (!runtimeMinutes || runtimeMinutes <= 0) return 0;
  const total = runtimeMinutes * 60;
  return Math.min(100, Math.round((progressSeconds / total) * 100));
}

/** A row's fixed card widths; a grid passes "w-full" and lets its columns decide. */
const ROW_CARD_WIDTH = "w-[160px] sm:w-[180px] md:w-[240px]";

/**
 * One movie card. Shared by the sideways rows and the full-shelf grid so a
 * title looks and behaves the same wherever it is listed.
 */
export function MovieCard({
  movie,
  progress,
  widthClass = ROW_CARD_WIDTH,
}: {
  movie: Movie;
  progress?: MovieProgress;
  widthClass?: string;
}) {
  const pct = progress ? progressPercent(progress.progressSeconds, progress.runtimeMinutes) : 0;
  const showProgress = progress && progress.progressSeconds > 0;
  const watchHref = `/watch/${movie.id}`;
  const idStr = String(movie.id);
  const onHover = useHoverPrefetch([watchHref], () => prefetchMovie(idStr));
  return (
    <div
      className={`movie-card group relative block ${widthClass} overflow-hidden rounded bg-netflix-dark touch-manipulation max-md:rounded-2xl max-md:shadow-lg max-md:shadow-black/40 max-md:ring-1 max-md:ring-white/5`}
    >
      <div className="relative aspect-video w-full">
        <Link
          href={watchHref}
          prefetch={false}
          className="absolute inset-0 z-0 block"
          onMouseEnter={onHover}
        >
          <CardArt
            backdrop={movie.backdrop}
            poster={movie.poster}
            alt={movie.title}
            sizes="(max-width: 640px) 160px, (max-width: 768px) 180px, 240px"
          />
        </Link>
        <div className="absolute inset-0 z-[1] bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        <PosterActions movieId={idStr} />
        {showProgress && (
          <div className="absolute bottom-0 left-0 right-0 z-[2] h-1 bg-white/30">
            <div className="h-full bg-netflix-red transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <Link
        href={watchHref}
        prefetch={false}
        onMouseEnter={onHover}
        className="block p-2"
      >
        <p className="text-white font-medium text-sm truncate">{movie.title}</p>
        <p className="text-white/60 text-xs">
          {showProgress
            ? `Resume · ${Math.floor(progress!.progressSeconds / 60)}m`
            : `${movie.year} · ${movie.rating}`}
        </p>
      </Link>
    </div>
  );
}

export function MovieRow({ title, movies, progressMap = {}, href }: MovieRowProps) {
  const shown = rowWindow(movies, Boolean(href));
  useEffect(() => {
    shown.forEach((m) => setMovieInCache(m.id, m));
  }, [shown]);
  return (
    <ScrollableRow title={title} href={href}>
      {shown.map((movie) => (
        <MovieCard key={movie.id} movie={movie} progress={progressMap[movie.id]} />
      ))}
    </ScrollableRow>
  );
}
