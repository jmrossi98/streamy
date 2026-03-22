"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { MovieRow } from "@/components/MovieRow";
import { ScrollableRow } from "@/components/ScrollableRow";
import { PosterWatchlistButton } from "@/components/PosterWatchlistButton";
import type { MovieProgress } from "@/components/MovieRow";
import type { Movie, TVShow } from "@/lib/tmdb";

type GenreRow = { title: string; movies: Movie[] };
type ProgressItem = { movieId: number; progressSeconds: number };

type Props = {
  trending: Movie[];
  genreRows: GenreRow[];
  trendingTV: TVShow[];
  progressList: ProgressItem[];
};

export function HomeMoviesSection({ trending, genreRows, trendingTV, progressList }: Props) {
  const [progressMap, setProgressMap] = useState<Record<string, MovieProgress>>({});

  const progressKey = progressList.length ? progressList.map((p) => p.movieId).sort((a, b) => a - b).join(",") : "";
  useEffect(() => {
    if (!progressKey) return;
    const ids = Array.from(new Set(progressList.map((p) => p.movieId))).slice(0, 50);
    fetch(`/api/movies/runtimes?ids=${ids.join(",")}`)
      .then((r) => r.json())
      .then((runtimes: Record<string, number | null>) => {
        const map: Record<string, MovieProgress> = {};
        progressList.forEach((p) => {
          map[String(p.movieId)] = {
            progressSeconds: p.progressSeconds,
            runtimeMinutes: runtimes[String(p.movieId)] ?? null,
          };
        });
        setProgressMap(map);
      })
      .catch(() => {});
  }, [progressKey, progressList]);

  return (
    <>
      <MovieRow title="Trending Now" movies={trending} progressMap={progressMap} />
      {trendingTV.length > 0 && (
        <ScrollableRow title="Trending TV">
          {trendingTV.map((show) => (
            <div
              key={show.id}
              className="movie-card group relative block w-[160px] sm:w-[180px] md:w-[240px] overflow-hidden rounded bg-netflix-dark touch-manipulation max-md:rounded-2xl max-md:shadow-lg max-md:shadow-black/40 max-md:ring-1 max-md:ring-white/5"
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
                <p className="text-white/60 text-xs">{show.year} · {show.rating}</p>
              </Link>
            </div>
          ))}
        </ScrollableRow>
      )}
      {genreRows.map(
        (row) =>
          row.movies.length > 0 && (
            <MovieRow key={row.title} title={row.title} movies={row.movies} progressMap={progressMap} />
          )
      )}
    </>
  );
}
