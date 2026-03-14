"use client";

import Image from "next/image";
import Link from "next/link";
import type { Movie } from "@/lib/tmdb";

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
  return (
    <section className="px-6 pt-2 pb-2">
      <h2 className="font-display text-2xl md:text-3xl font-bold text-white mb-2">
        {title}
      </h2>
      <div className="movie-row">
        {movies.map((movie) => {
          const progress = progressMap[movie.id];
          const pct = progress
            ? progressPercent(progress.progressSeconds, progress.runtimeMinutes)
            : 0;
          const showProgress = progress && progress.progressSeconds > 0;
          return (
            <Link
              key={movie.id}
              href={`/watch/${movie.id}`}
              className="movie-card block w-[180px] md:w-[240px] rounded overflow-hidden bg-netflix-dark"
            >
              <div className="relative aspect-video w-full">
                <Image
                  src={movie.poster}
                  alt={movie.title}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 180px, 240px"
                  unoptimized
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center text-netflix-black">
                    <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </div>
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
      </div>
    </section>
  );
}
