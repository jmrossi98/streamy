"use client";

import { useState, useEffect } from "react";
import { MovieRow } from "@/components/MovieRow";
import { ShowCard, TVRow } from "@/components/TVRow";
import { MixedRow } from "@/components/MixedRow";
import { ScrollableRow } from "@/components/ScrollableRow";
import type { MovieProgress } from "@/components/MovieRow";
import type { Movie, PersonTitle, TVShow } from "@/lib/tmdb";
import { rowOverflows, shelfHref } from "@/lib/browseShelfRules";

type Row = { title: string; movies: Movie[]; href?: string; total?: number | null };
type ShowRow = { title: string; shows: TVShow[]; href?: string; total?: number | null };
type Mixed = { title: string; items: PersonTitle[]; href?: string; total?: number | null };
type ProgressItem = { movieId: number; progressSeconds: number };

type Props = {
  trending: Movie[];
  /** How many the Trending shelves hold; see MovieRow. */
  trendingTotal?: number | null;
  trendingTVTotal?: number | null;
  /** Every movie row under Trending, in page order: the lead genres and the rows among them. */
  rows: Row[];
  trendingTV: TVShow[];
  progressList: ProgressItem[];
  /** The holiday in season and what is new, each across movies and shows. */
  holiday?: Mixed | null;
  recent?: Mixed | null;
  /** Everything downloaded, A to Z, by kind; each heading opens the full grid. */
  allMovies?: Row | null;
  allShows?: ShowRow | null;
};

export function HomeMoviesSection({
  trending,
  trendingTotal,
  trendingTVTotal,
  rows,
  trendingTV,
  progressList,
  holiday = null,
  recent = null,
  allMovies = null,
  allShows = null,
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
      {/* First, so directly under My List: the way into the whole library. */}
      {allMovies && allMovies.movies.length > 0 && (
        <MovieRow
          title={allMovies.title}
          movies={allMovies.movies}
          progressMap={progressMap}
          href={allMovies.href}
          total={allMovies.total}
        />
      )}
      {allShows && allShows.shows.length > 0 && (
        <TVRow title={allShows.title} shows={allShows.shows} href={allShows.href} total={allShows.total} />
      )}
      {/* Then the one row that changes with the calendar: movies and shows
          together, like My List above it. */}
      {holiday && holiday.items.length > 0 && (
        <MixedRow title={holiday.title} items={holiday.items} href={holiday.href} total={holiday.total} progressMap={progressMap} />
      )}
      <MovieRow
        title="Trending Now"
        movies={trending}
        progressMap={progressMap}
        href={shelfHref("movies", { kind: "trending" })}
        total={trendingTotal}
      />
      {trendingTV.length > 0 && (
        <ScrollableRow
          title="Trending TV"
          href={shelfHref("tv", { kind: "trending" })}
          more={
            rowOverflows(trendingTV.length, trendingTVTotal ?? trendingTV.length, true)
              ? { href: shelfHref("tv", { kind: "trending" }), total: trendingTVTotal ?? null }
              : undefined
          }
        >
          {trendingTV.map((show) => (
            <ShowCard key={show.id} show={show} widthClass="w-[160px] sm:w-[180px] md:w-[240px]" />
          ))}
        </ScrollableRow>
      )}
      {/* What is new, across both kinds, then the movie rows. */}
      {recent && recent.items.length > 0 && (
        <MixedRow title={recent.title} items={recent.items} href={recent.href} total={recent.total} progressMap={progressMap} />
      )}
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
    </>
  );
}
