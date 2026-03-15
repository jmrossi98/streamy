"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { MovieRow } from "@/components/MovieRow";
import { ScrollableRow } from "@/components/ScrollableRow";
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
                <p className="text-white/60 text-xs">{show.year} · {show.rating}</p>
              </div>
            </Link>
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
