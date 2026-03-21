"use client";

import Image from "next/image";
import Link from "next/link";
import type { Movie, TVShow } from "@/lib/tmdb";
import { ScrollableRow } from "@/components/ScrollableRow";
import { PosterWatchlistButton } from "@/components/PosterWatchlistButton";

type MovieItem = { movie: Movie; progressSeconds: number; runtimeMinutes: number | null };
type ShowItem = { show: TVShow };

type RecentlyWatchedRowProps = {
  items: MovieItem[];
  showItems?: ShowItem[];
};

function progressPercent(progressSeconds: number, runtimeMinutes: number | null): number {
  if (!runtimeMinutes || runtimeMinutes <= 0) return 0;
  const total = runtimeMinutes * 60;
  return Math.min(100, Math.round((progressSeconds / total) * 100));
}

export function RecentlyWatchedRow({ items, showItems = [] }: RecentlyWatchedRowProps) {
  const hasAny = items.length > 0 || showItems.length > 0;

  if (!hasAny) {
    return (
      <section className="px-6 pb-2 min-h-[4rem]" aria-label="Recently Watched">
        <h2 className="font-display text-2xl md:text-3xl font-bold text-white mb-2 block">
          Recently Watched
        </h2>
        <p className="text-white/60 text-sm">Start watching to see your progress here.</p>
      </section>
    );
  }

  return (
    <ScrollableRow title="Recently Watched">
      {items.map(({ movie, progressSeconds, runtimeMinutes }) => {
        const pct = progressPercent(progressSeconds, runtimeMinutes);
        const idStr = String(movie.id);
        return (
          <div
            key={movie.id}
            className="movie-card group relative block w-[160px] sm:w-[180px] md:w-[240px] rounded overflow-hidden bg-netflix-dark touch-manipulation"
          >
            <div className="relative aspect-video w-full">
              <Link href={`/watch/${movie.id}`} className="absolute inset-0 z-0 block">
                <Image
                  src={movie.poster}
                  alt={movie.title}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 160px, (max-width: 768px) 180px, 240px"
                />
              </Link>
              <div className="absolute inset-0 z-[1] bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
              <PosterWatchlistButton
                movieId={idStr}
                className="absolute top-2 right-2 z-[5] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
              />
              {progressSeconds > 0 && (
                <div className="absolute bottom-0 left-0 right-0 z-[2] h-1 bg-white/30">
                  <div
                    className="h-full bg-netflix-red transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
            <Link href={`/watch/${movie.id}`} className="block p-2">
              <p className="text-white font-medium text-sm truncate">{movie.title}</p>
              <p className="text-white/60 text-xs">
                {progressSeconds > 0
                  ? `Resume · ${Math.floor(progressSeconds / 60)}m`
                  : `${movie.year} · ${movie.rating}`}
              </p>
            </Link>
          </div>
        );
      })}
      {showItems.map(({ show }) => (
        <div
          key={show.id}
          className="movie-card group relative block w-[160px] sm:w-[180px] md:w-[240px] rounded overflow-hidden bg-netflix-dark touch-manipulation"
        >
          <div className="relative aspect-video w-full">
            <Link href={`/show/${show.id}`} className="absolute inset-0 z-0 block">
              <Image
                src={show.poster}
                alt={show.name}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 160px, (max-width: 768px) 180px, 240px"
              />
            </Link>
            <div className="absolute inset-0 z-[1] bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            <PosterWatchlistButton
              showId={String(show.id)}
              className="absolute top-2 right-2 z-[5] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            />
          </div>
          <Link href={`/show/${show.id}`} className="block p-2">
            <p className="text-white font-medium text-sm truncate">{show.name}</p>
            <p className="text-white/60 text-xs">
              {show.year} · TV
            </p>
          </Link>
        </div>
      ))}
    </ScrollableRow>
  );
}
