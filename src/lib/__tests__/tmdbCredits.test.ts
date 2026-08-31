import { describe, it, expect, vi } from "vitest";

// tmdb.ts calls React's cache() at module load to memoize several exports
// (getShowById, getMovieById, ...) -- real behavior under Next.js, which
// provides the "react-server" runtime condition that supplies it, but plain
// vitest doesn't, so a bare import of the module throws before any test here
// even runs. Only extractCredits/mergeCombinedCredits are under test, both
// plain functions with no caching of their own -- a pass-through stub is all
// this file needs, not a real cache. vi.mock is hoisted above the import
// below regardless of source order, so this runs before tmdb.ts loads.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

import {
  extractCredits,
  mergeCombinedCredits,
  type TmdbCombinedCreditItem,
  type TmdbGenre,
  type TmdbGenreTV,
} from "../tmdb";

// Every credit needs to link to /person/[id] -- clicking a cast or crew name
// opens that person's filmography. Names alone can't do that (TMDB has no
// per-title name-to-person shortcut), so this locks in that the id survives.
describe("extractCredits", () => {
  it("keeps each cast member's id", () => {
    const credits = extractCredits({ cast: [{ id: 42, name: "Rian Johnson's Friend", character: "Detective" }] });
    expect(credits.cast[0]).toMatchObject({ id: 42, name: "Rian Johnson's Friend" });
  });

  it("keeps crew ids for director/writer/producer, not just names", () => {
    const credits = extractCredits({
      crew: [
        { id: 1, name: "A Director", job: "Director" },
        { id: 2, name: "A Writer", job: "Screenplay" },
        { id: 3, name: "A Producer", job: "Executive Producer" },
      ],
    });
    expect(credits.director).toEqual([{ id: 1, name: "A Director" }]);
    expect(credits.writer).toEqual([{ id: 2, name: "A Writer" }]);
    expect(credits.producer).toEqual([{ id: 3, name: "A Producer" }]);
  });

  it("prefers TV created_by over a Director crew credit, keeping its id", () => {
    const credits = extractCredits(
      { crew: [{ id: 99, name: "Not The Creator", job: "Director" }] },
      [{ id: 7, name: "The Creator" }]
    );
    expect(credits.director).toEqual([{ id: 7, name: "The Creator" }]);
  });

  it("de-duplicates a crew member holding two jobs in the same category", () => {
    // e.g. credited as both "Producer" and "Executive Producer" on one title.
    const credits = extractCredits({
      crew: [
        { id: 5, name: "Prolific Producer", job: "Producer" },
        { id: 5, name: "Prolific Producer", job: "Executive Producer" },
      ],
    });
    expect(credits.producer).toEqual([{ id: 5, name: "Prolific Producer" }]);
  });
});

// A person's filmography merges two separate TMDB lists (cast and crew) that
// can both contain the same title -- an actor-director appears in both. Not
// deduping here means the exact same poster shows up twice in a row on their
// page, which is the failure this locks in against.
describe("mergeCombinedCredits", () => {
  const movieGenres: TmdbGenre[] = [{ id: 18, name: "Drama" }];
  const tvGenres: TmdbGenreTV[] = [{ id: 35, name: "Comedy" }];

  const movieCredit = (over: Partial<TmdbCombinedCreditItem> = {}): TmdbCombinedCreditItem => ({
    id: 1,
    media_type: "movie",
    title: "A Movie",
    overview: "",
    poster_path: null,
    backdrop_path: null,
    vote_average: 7,
    popularity: 10,
    release_date: "2020-01-01",
    genre_ids: [18],
    ...over,
  });

  const tvCredit = (over: Partial<TmdbCombinedCreditItem> = {}): TmdbCombinedCreditItem => ({
    id: 2,
    media_type: "tv",
    name: "A Show",
    overview: "",
    poster_path: null,
    backdrop_path: null,
    vote_average: 8,
    popularity: 10,
    first_air_date: "2019-01-01",
    genre_ids: [35],
    ...over,
  });

  it("dedupes a title credited in both cast and crew", () => {
    const { movies } = mergeCombinedCredits([movieCredit()], [movieCredit()], movieGenres, tvGenres);
    expect(movies).toHaveLength(1);
  });

  it("does not merge a movie and a show that happen to share a TMDB id", () => {
    // TMDB ids are only unique within a media type -- movie 1 and tv 1 are
    // different titles. Keying the dedup by id alone would drop one.
    const { movies, shows } = mergeCombinedCredits(
      [movieCredit({ id: 1 }), tvCredit({ id: 1 })],
      [],
      movieGenres,
      tvGenres
    );
    expect(movies).toHaveLength(1);
    expect(shows).toHaveLength(1);
  });

  it("keeps two genuinely different titles of the same type", () => {
    const { movies } = mergeCombinedCredits(
      [movieCredit({ id: 1, title: "First" }), movieCredit({ id: 2, title: "Second" })],
      [],
      movieGenres,
      tvGenres
    );
    expect(movies.map((m) => m.title)).toEqual(["First", "Second"]);
  });

  it("sorts movies most popular first, not by release date", () => {
    // Deliberately out of date order -- if this ever sorted by date instead,
    // the assertion below would catch it immediately.
    const { movies } = mergeCombinedCredits(
      [
        movieCredit({ id: 1, title: "Minor Role", popularity: 5, release_date: "2022-01-01" }),
        movieCredit({ id: 2, title: "Breakout Hit", popularity: 80, release_date: "2001-01-01" }),
        movieCredit({ id: 3, title: "Solid Credit", popularity: 20, release_date: "2015-01-01" }),
      ],
      [],
      movieGenres,
      tvGenres
    );
    expect(movies.map((m) => m.title)).toEqual(["Breakout Hit", "Solid Credit", "Minor Role"]);
  });

  it("sorts shows most popular first", () => {
    const { shows } = mergeCombinedCredits(
      [],
      [
        tvCredit({ id: 1, name: "Cult Favorite", popularity: 15, first_air_date: "2023-01-01" }),
        tvCredit({ id: 2, name: "The Hit Show", popularity: 90, first_air_date: "2005-01-01" }),
      ],
      movieGenres,
      tvGenres
    );
    expect(shows.map((s) => s.name)).toEqual(["The Hit Show", "Cult Favorite"]);
  });

  it("doesn't crash on a credit with no popularity score -- sorts it last rather than throwing", () => {
    const { movies } = mergeCombinedCredits(
      [
        movieCredit({ id: 1, title: "Scored", popularity: 10 }),
        movieCredit({ id: 2, title: "Unscored", popularity: undefined }),
      ],
      [],
      movieGenres,
      tvGenres
    );
    expect(movies.map((m) => m.title)).toEqual(["Scored", "Unscored"]);
  });
});
