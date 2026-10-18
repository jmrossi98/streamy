"use client";

import { useState, useEffect } from "react";
import { MovieRow } from "@/components/MovieRow";
import { ShowCard, TVRow } from "@/components/TVRow";
import { ScrollableRow } from "@/components/ScrollableRow";
import type { MovieProgress } from "@/components/MovieRow";
import type { Movie, TVShow } from "@/lib/tmdb";
import { shelfHref } from "@/lib/browseShelfRules";

type Row = { title: string; movies: Movie[]; href?: string };
type ShowRow = { title: string; shows: TVShow[]; href?: string };
type ProgressItem = { movieId: number; progressSeconds: number };

type Props = {
  trending: Movie[];
  /** Every movie row under Trending, in page order: the lead genres and the rows among them. */
  rows: Row[];
  /** The TV rows under Trending TV; Home has room for what is new. */
  showRows?: ShowRow[];
  trendingTV: TVShow[];
  progressList: ProgressItem[];
  /** The holiday in season, by kind; either may be missing. */
  holidayMovies?: Row | null;
  holidayShows?: ShowRow | null;
  /** Everything downloaded, A to Z, by kind; each heading opens the full grid. */
  allMovies?: Row | null;
  allShows?: ShowRow | null;
};

export function HomeMoviesSection({
  trending,
  rows,
  showRows = [],
  trendingTV,
  progressList,
  holidayMovies = null,
  holidayShows = null,
  allMovies = null,
  allShows = null,
}: Props) {
  const [progressMap, setProgressMap] = useState<Record<string, MovieProgress>>({});
  const showRowTitles = new Set(showRows.map((row) => row.title));

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
      {/* TV's rows under its Trending, then the movie rows. A heading both
          kinds use ("Recently Added") is titled by kind, as the holiday rows
          are, so the page never shows two rows with one name. */}
      {showRows.map(
        (row) =>
          row.shows.length > 0 && (
            <TVRow key={`tv-${row.title}`} title={`${row.title} - Shows`} shows={row.shows} href={row.href} />
          )
      )}
      {rows.map(
        (row) =>
          row.movies.length > 0 && (
            <MovieRow
              key={row.title}
              title={showRowTitles.has(row.title) ? `${row.title} - Movies` : row.title}
              movies={row.movies}
              progressMap={progressMap}
              href={row.href}
            />
          )
      )}
    </>
  );
}
