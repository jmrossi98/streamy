"use client";

import { useState, useEffect } from "react";
import { MovieRow } from "@/components/MovieRow";
import type { MovieProgress } from "@/components/MovieRow";
import type { Movie } from "@/lib/tmdb";
import { shelfHref } from "@/lib/browseShelfRules";

type Row = { title: string; movies: Movie[]; href?: string; total?: number | null };
type ProgressItem = { movieId: number; progressSeconds: number };

type Props = {
  trending: Movie[];
  /** How many the Trending shelf holds; see MovieRow. */
  trendingTotal?: number | null;
  /** Every row under Trending, in page order: genres and the rows among them. */
  rows: Row[];
  progressList: ProgressItem[];
  /** The viewer's saved movies. Empty for a signed-out viewer, or an empty list. */
  myList?: Movie[];
  /** How many they have saved in all, when the row holds only the first of them. */
  myListTotal?: number;
  /** The holiday in season, when the library has anything for it. */
  holiday?: Row | null;
  /** Everything downloaded, A to Z; its heading opens the full grid. */
  all?: Row | null;
};

export function MoviesContent({
  trending,
  trendingTotal,
  rows,
  progressList,
  myList = [],
  myListTotal,
  holiday = null,
  all = null,
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
          total={myListTotal}
        />
      )}
      {/* The way into the whole library, kept next to the viewer's own list. */}
      {all && all.movies.length > 0 && (
        <MovieRow title={all.title} movies={all.movies} progressMap={progressMap} href={all.href} total={all.total} />
      )}
      {/* Under those: the one row that changes with the calendar,
          so it goes where it will be seen while it is in season. */}
      {holiday && holiday.movies.length > 0 && (
        <MovieRow title={holiday.title} movies={holiday.movies} progressMap={progressMap} href={holiday.href} total={holiday.total} />
      )}
      <MovieRow
        title="Trending Now"
        movies={trending}
        progressMap={progressMap}
        href={shelfHref("movies", { kind: "trending" })}
        total={trendingTotal}
      />
      {rows.map(
        (row) =>
          row.movies.length > 0 && (
            <MovieRow
              key={row.title}
              title={row.title}
              movies={row.movies}
              progressMap={progressMap}
              href={row.href}
              total={row.total}
            />
          )
      )}
    </div>
  );
}
