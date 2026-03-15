"use client";

import Image from "next/image";
import Link from "next/link";
import type { Movie, TVShow } from "@/lib/tmdb";
import { ScrollableRow } from "@/components/ScrollableRow";

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
          return (
            <Link
              key={movie.id}
              href={`/watch/${movie.id}`}
              className="movie-card block w-[160px] sm:w-[180px] md:w-[240px] rounded overflow-hidden bg-netflix-dark touch-manipulation"
            >
              <div className="relative aspect-video w-full">
                <Image
                  src={movie.poster}
                  alt={movie.title}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 160px, (max-width: 768px) 180px, 240px"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity" />
                {progressSeconds > 0 && (
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
                  {progressSeconds > 0
                    ? `Resume · ${Math.floor(progressSeconds / 60)}m`
                    : `${movie.year} · ${movie.rating}`}
                </p>
              </div>
            </Link>
          );
        })}
      {showItems.map(({ show }) => (
          <Link
            key={show.id}
            href={`/show/${show.id}`}
            className="movie-card block w-[160px] sm:w-[180px] md:w-[240px] rounded overflow-hidden bg-netflix-dark touch-manipulation"
          >
            <div className="relative aspect-video w-full">
              <Image
                src={show.poster}
                alt={show.name}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 160px, (max-width: 768px) 180px, 240px"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity" />
            </div>
            <div className="p-2">
              <p className="text-white font-medium text-sm truncate">{show.name}</p>
              <p className="text-white/60 text-xs">{show.year} · TV</p>
            </div>
          </Link>
        ))}
    </ScrollableRow>
  );
}
