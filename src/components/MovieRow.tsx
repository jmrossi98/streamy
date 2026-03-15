"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Movie } from "@/lib/tmdb";
import { ScrollableRow } from "@/components/ScrollableRow";
import { setMovieInCache } from "@/lib/movieCache";

/** Warm movie cache on hover so /watch/[id] play loads fast when they click. */
function prefetchMovie(id: string) {
  fetch(`/api/movies/${id}`).catch(() => {});
}

export type MovieProgress = { progressSeconds: number; runtimeMinutes: number | null };

type MovieRowProps = {
  title: string;
  movies: Movie[];
  progressMap?: Record<string, MovieProgress>;
};

function progressPercent(progressSeconds: number, runtimeMinutes: number | null): number {
  if (!runtimeMinutes || runtimeMinutes <= 0) return 0;
  const total = runtimeMinutes * 60;
  return Math.min(100, Math.round((progressSeconds / total) * 100));
}

export function MovieRow({ title, movies, progressMap = {} }: MovieRowProps) {
  const router = useRouter();
  useEffect(() => {
    movies.forEach((m) => setMovieInCache(m.id, m));
  }, [movies]);
  return (
    <ScrollableRow title={title}>
      {movies.map((movie) => {
        const progress = progressMap[movie.id];
        const pct = progress
          ? progressPercent(progress.progressSeconds, progress.runtimeMinutes)
          : 0;
        const showProgress = progress && progress.progressSeconds > 0;
        const watchHref = `/watch/${movie.id}`;
        return (
          <Link
            key={movie.id}
            href={watchHref}
            prefetch
            onMouseEnter={() => {
              prefetchMovie(movie.id);
              router.prefetch(watchHref);
            }}
            className="movie-card block w-[160px] sm:w-[180px] md:w-[240px] rounded overflow-hidden bg-netflix-dark touch-manipulation"
          >
            <div className="relative aspect-video w-full">
              <Image
                src={movie.poster}
                alt={movie.title}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 160px, (max-width: 768px) 180px, 240px"
                unoptimized
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity" />
              {showProgress && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
                  <div
                    className="h-full bg-netflix-red transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="text-white font-medium text-sm truncate">{movie.title}</p>
              <p className="text-white/60 text-xs">
                {showProgress
                  ? `Resume · ${Math.floor(progress!.progressSeconds / 60)}m`
                  : `${movie.year} · ${movie.rating}`}
              </p>
            </div>
          </Link>
        );
      })}
    </ScrollableRow>
  );
}
