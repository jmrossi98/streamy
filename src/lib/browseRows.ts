/**
 * The rows on Home, Movies and TV Shows, and the shelves behind them.
 *
 * One place decides what a row holds so the row and the grid its heading
 * opens cannot disagree: both are the downloaded library, cut the same way.
 *
 * When the library cannot be read at all -- no Radarr configured, as in
 * development and the e2e run, or the home server unreachable since boot --
 * the rows fall back to TMDB's own lists, which is what these pages showed
 * before. A page of things to request beats an empty page.
 */
import {
  getDiscoverByGenre,
  getDiscoverByGenrePages,
  getDiscoverTVByGenre,
  getDiscoverTVByGenrePages,
  getGenres,
  getTrending,
  getTrendingPages,
  getTrendingTV,
  getTrendingTVPages,
  getTVGenres,
  type Movie,
  type TVShow,
} from "./tmdb";
import { getLibraryMovies, getLibraryShows, type LibraryMovie, type LibraryShow } from "./downloadedLibrary";
import { shelfHref, type Shelf } from "./browseShelfRules";
import { byPopularity, genreBuckets, inGenre } from "./libraryRowRules";
import { holidayNow, pickHolidayTitles } from "./holidayRules";

/**
 * How many cards a row holds. The heading opens the whole shelf, and nobody
 * scrolls forty tiles sideways to find out what is at the end.
 */
const ROW_LIMIT = 20;

/**
 * The movie genres that lead, in this order: the five the pages have always
 * opened with, and Western. Home shows only these; Movies follows them with
 * every other genre that has something downloaded.
 */
const LEAD_MOVIE_GENRES = [28, 35, 18, 27, 878, 37]; // Action, Comedy, Drama, Horror, Sci-Fi, Western

const FALLBACK_TV_GENRES = 4;
const FALLBACK_ROW_SIZE = 8;

export type MovieRowData = { title: string; href: string; movies: Movie[] };
export type ShowRowData = { title: string; href: string; shows: TVShow[] };

// Keywords are for matching, not for the browser: a title's can run to
// thirty strings, sent once per row it appears in.
function movieCard(movie: LibraryMovie): Movie {
  const { keywords: _keywords, ...card } = movie;
  return card;
}

function showCard(show: LibraryShow): TVShow {
  const { keywords: _keywords, ...card } = show;
  return card;
}

/** The library when it has something in it; null sends the caller to TMDB. */
async function movieLibrary(): Promise<LibraryMovie[] | null> {
  const library = await getLibraryMovies();
  return library && library.length > 0 ? byPopularity(library) : null;
}

async function showLibrary(): Promise<LibraryShow[] | null> {
  const library = await getLibraryShows();
  return library && library.length > 0 ? byPopularity(library) : null;
}

export type MovieBrowse = {
  trending: Movie[];
  /** The holiday in season, when the library has anything for it. */
  holiday: MovieRowData | null;
  genreRows: MovieRowData[];
};

/** `leadOnly` keeps to the lead genres, for Home, where movies share the page. */
export async function getMovieBrowse({ leadOnly = false }: { leadOnly?: boolean } = {}): Promise<MovieBrowse> {
  const [library, genres] = await Promise.all([movieLibrary(), getGenres()]);

  if (!library) {
    const [trending, lists] = await Promise.all([
      getTrending(10),
      Promise.all(LEAD_MOVIE_GENRES.map((id) => getDiscoverByGenre(id, FALLBACK_ROW_SIZE))),
    ]);
    return {
      trending,
      holiday: null,
      genreRows: LEAD_MOVIE_GENRES.map((id, i) => ({
        title: genres.find((g) => g.id === id)?.name ?? "Genre",
        href: shelfHref("movies", { kind: "genre", genreId: id }),
        movies: lists[i] ?? [],
      })),
    };
  }

  const holiday = holidayNow();
  const holidayMovies = holiday ? pickHolidayTitles(holiday, library) : [];
  const buckets = genreBuckets(library, genres, LEAD_MOVIE_GENRES).filter(
    (b) => !leadOnly || LEAD_MOVIE_GENRES.includes(b.genre.id)
  );

  return {
    trending: library.slice(0, ROW_LIMIT).map(movieCard),
    holiday:
      holiday && holidayMovies.length > 0
        ? {
            title: holiday.title,
            href: shelfHref("movies", { kind: "holiday" }),
            movies: holidayMovies.slice(0, ROW_LIMIT).map(movieCard),
          }
        : null,
    genreRows: buckets.map((b) => ({
      title: b.genre.name,
      href: shelfHref("movies", { kind: "genre", genreId: b.genre.id }),
      movies: b.titles.slice(0, ROW_LIMIT).map(movieCard),
    })),
  };
}

export type ShowBrowse = {
  trending: TVShow[];
  holiday: ShowRowData | null;
  genreRows: ShowRowData[];
};

/** `genreRows: false` skips the genre rows, for Home, which has none for TV. */
export async function getShowBrowse({ genreRows = true }: { genreRows?: boolean } = {}): Promise<ShowBrowse> {
  const library = await showLibrary();

  if (!library) {
    const trending = getTrendingTV(10);
    if (!genreRows) return { trending: await trending, holiday: null, genreRows: [] };
    const genres = (await getTVGenres()).slice(0, FALLBACK_TV_GENRES);
    const lists = await Promise.all(genres.map((g) => getDiscoverTVByGenre(g.id, FALLBACK_ROW_SIZE)));
    return {
      trending: await trending,
      holiday: null,
      genreRows: genres.map((g, i) => ({
        title: g.name,
        href: shelfHref("tv", { kind: "genre", genreId: g.id }),
        shows: lists[i] ?? [],
      })),
    };
  }

  const holiday = holidayNow();
  const holidayShows = holiday ? pickHolidayTitles(holiday, library) : [];
  const buckets = genreRows ? genreBuckets(library, await getTVGenres()) : [];

  return {
    trending: library.slice(0, ROW_LIMIT).map(showCard),
    holiday:
      holiday && holidayShows.length > 0
        ? {
            title: holiday.title,
            href: shelfHref("tv", { kind: "holiday" }),
            shows: holidayShows.slice(0, ROW_LIMIT).map(showCard),
          }
        : null,
    genreRows: buckets.map((b) => ({
      title: b.genre.name,
      href: shelfHref("tv", { kind: "genre", genreId: b.genre.id }),
      shows: b.titles.slice(0, ROW_LIMIT).map(showCard),
    })),
  };
}

/** Every shelf but the viewer's own list, which is theirs and not the library's. */
type LibraryShelf = Exclude<Shelf, { kind: "my-list" }>;

/** One shelf in full. `paged` is true only for TMDB's lists, which grow with "Load more". */
export type ShelfContents<T> = { title: string; items: T[]; paged: boolean };

/** Everything on a movie shelf, or null when there is no such shelf today. */
export async function getMovieShelf(shelf: LibraryShelf, pages: number): Promise<ShelfContents<Movie> | null> {
  const [library, genres] = await Promise.all([movieLibrary(), getGenres()]);

  if (shelf.kind === "genre") {
    const genre = genres.find((g) => g.id === shelf.genreId);
    if (!genre) return null;
    return library
      ? { title: genre.name, items: inGenre(library, genre.name).map(movieCard), paged: false }
      : { title: genre.name, items: await getDiscoverByGenrePages(genre.id, pages), paged: true };
  }

  if (shelf.kind === "trending") {
    return library
      ? { title: "Trending Now", items: library.map(movieCard), paged: false }
      : { title: "Trending Now", items: await getTrendingPages(pages), paged: true };
  }

  // The holiday shelf exists only in season, and only over the library.
  const holiday = holidayNow();
  if (!holiday || !library) return null;
  return { title: holiday.title, items: pickHolidayTitles(holiday, library).map(movieCard), paged: false };
}

export async function getShowShelf(shelf: LibraryShelf, pages: number): Promise<ShelfContents<TVShow> | null> {
  const [library, genres] = await Promise.all([showLibrary(), getTVGenres()]);

  if (shelf.kind === "genre") {
    const genre = genres.find((g) => g.id === shelf.genreId);
    if (!genre) return null;
    return library
      ? { title: genre.name, items: inGenre(library, genre.name).map(showCard), paged: false }
      : { title: genre.name, items: await getDiscoverTVByGenrePages(genre.id, pages), paged: true };
  }

  if (shelf.kind === "trending") {
    return library
      ? { title: "Trending TV", items: library.map(showCard), paged: false }
      : { title: "Trending TV", items: await getTrendingTVPages(pages), paged: true };
  }

  const holiday = holidayNow();
  if (!holiday || !library) return null;
  return { title: holiday.title, items: pickHolidayTitles(holiday, library).map(showCard), paged: false };
}

export type ShelfLink = { shelf: Shelf; label: string };

/**
 * The shelves worth offering beside the one being read: the same ones the
 * rows on the tab page lead to, so a genre with nothing downloaded is not
 * offered as somewhere to go.
 */
export async function getMovieShelfLinks(): Promise<ShelfLink[]> {
  const [library, genres] = await Promise.all([movieLibrary(), getGenres()]);
  const holiday = holidayNow();
  const offered = library ? genreBuckets(library, genres, LEAD_MOVIE_GENRES).map((b) => b.genre) : genres;
  return [
    { shelf: { kind: "trending" }, label: "Trending Now" },
    ...(holiday && library && pickHolidayTitles(holiday, library).length > 0
      ? [{ shelf: { kind: "holiday" as const }, label: holiday.title }]
      : []),
    ...offered.map((g) => ({ shelf: { kind: "genre" as const, genreId: g.id }, label: g.name })),
  ];
}

export async function getShowShelfLinks(): Promise<ShelfLink[]> {
  const [library, genres] = await Promise.all([showLibrary(), getTVGenres()]);
  const holiday = holidayNow();
  const offered = library ? genreBuckets(library, genres).map((b) => b.genre) : genres;
  return [
    { shelf: { kind: "trending" }, label: "Trending TV" },
    ...(holiday && library && pickHolidayTitles(holiday, library).length > 0
      ? [{ shelf: { kind: "holiday" as const }, label: holiday.title }]
      : []),
    ...offered.map((g) => ({ shelf: { kind: "genre" as const, genreId: g.id }, label: g.name })),
  ];
}
