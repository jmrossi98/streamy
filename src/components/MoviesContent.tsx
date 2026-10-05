"use client";

import { useState, useEffect } from "react";
import { MovieRow } from "@/components/MovieRow";
import type { MovieProgress } from "@/components/MovieRow";
import type { Movie } from "@/lib/tmdb";
import { shelfHref } from "@/lib/browseShelfRules";

type GenreRow = { title: string; movies: Movie[]; href?: string };
type ProgressItem = { movieId: number; progressSeconds: number };

type Props = {
  trending: Movie[];
  genreRows: GenreRow[];
  progressList: ProgressItem[];
  /** The viewer's saved movies. Empty for a signed-out viewer, or an empty list. */
  myList?: Movie[];
  /** The holiday in season, when the library has anything for it. */
  holiday?: GenreRow | null;
};

export function MoviesContent({
  trending,
  genreRows,
  progressList,
  myList = [],
  holiday = null,
}: Props) {
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
          const runtime = runtimes[String(p.movieId)] ?? null;
          map[String(p.movieId)] = { progressSeconds: p.progressSeconds, runtimeMinutes: runtime };
        });
        setProgressMap(map);
      })
      .catch(() => {});
  }, [progressKey, progressList]);

  return (
    <div className="space-y-2 [&>*:first-child]:pt-0">
      {/* Above Trending: what the viewer chose for themselves outranks what
          is merely popular. Hidden entirely when empty rather than shown as an
          empty row. */}
      {myList.length > 0 && (
        <MovieRow
          title="My List"
          movies={myList}
          progressMap={progressMap}
          href={shelfHref("movies", { kind: "my-list" })}
        />
      )}
      {/* Directly under My List: the one row that changes with the calendar,
          so it goes where it will be seen while it is in season. */}
      {holiday && holiday.movies.length > 0 && (
        <MovieRow title={holiday.title} movies={holiday.movies} progressMap={progressMap} href={holiday.href} />
      )}
      <MovieRow
        title="Trending Now"
        movies={trending}
        progressMap={progressMap}
        href={shelfHref("movies", { kind: "trending" })}
      />
      {genreRows.map(
        (row) =>
          row.movies.length > 0 && (
            <MovieRow
              key={row.title}
              title={row.title}
              movies={row.movies}
              progressMap={progressMap}
              href={row.href}
            />
          )
      )}
    </div>
  );
}
