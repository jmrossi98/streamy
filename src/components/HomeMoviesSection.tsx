"use client";

import { useState, useEffect } from "react";
import { MovieRow } from "@/components/MovieRow";
import { ShowCard, TVRow } from "@/components/TVRow";
import { ScrollableRow } from "@/components/ScrollableRow";
import type { MovieProgress } from "@/components/MovieRow";
import type { Movie, TVShow } from "@/lib/tmdb";
import { shelfHref } from "@/lib/browseShelfRules";

type GenreRow = { title: string; movies: Movie[]; href?: string };
type ProgressItem = { movieId: number; progressSeconds: number };

type Props = {
  trending: Movie[];
  genreRows: GenreRow[];
  trendingTV: TVShow[];
  progressList: ProgressItem[];
  /** The holiday in season, by kind; either may be missing. */
  holidayMovies?: GenreRow | null;
  holidayShows?: { title: string; shows: TVShow[]; href?: string } | null;
  /** Everything downloaded, A to Z, by kind; each heading opens the full grid. */
  allMovies?: GenreRow | null;
  allShows?: { title: string; shows: TVShow[]; href?: string } | null;
};

export function HomeMoviesSection({
  trending,
  genreRows,
  trendingTV,
  progressList,
  holidayMovies = null,
  holidayShows = null,
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
        <MovieRow title={allMovies.title} movies={allMovies.movies} progressMap={progressMap} href={allMovies.href} />
      )}
      {allShows && allShows.shows.length > 0 && <TVRow title={allShows.title} shows={allShows.shows} href={allShows.href} />}
      {/* Then the one row that changes with the
          calendar. Titled by kind for the reason My List is on this page --
          two rows both called "Halloween" read as one row that broke. */}
      {holidayMovies && holidayMovies.movies.length > 0 && (
        <MovieRow
          title={`${holidayMovies.title} - Movies`}
          movies={holidayMovies.movies}
          progressMap={progressMap}
          href={holidayMovies.href}
        />
      )}
      {holidayShows && holidayShows.shows.length > 0 && (
        <TVRow title={`${holidayShows.title} - Shows`} shows={holidayShows.shows} href={holidayShows.href} />
      )}
      <MovieRow
        title="Trending Now"
        movies={trending}
        progressMap={progressMap}
        href={shelfHref("movies", { kind: "trending" })}
      />
      {trendingTV.length > 0 && (
        <ScrollableRow title="Trending TV" href={shelfHref("tv", { kind: "trending" })}>
          {trendingTV.map((show) => (
            <ShowCard key={show.id} show={show} widthClass="w-[160px] sm:w-[180px] md:w-[240px]" />
          ))}
        </ScrollableRow>
      )}
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
    </>
  );
}
