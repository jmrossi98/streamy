/**
 * The rows on Home, Movies and TV Shows, and the shelves behind them.
 *
 * One place decides what a row holds so the row and the grid its heading
 * opens cannot disagree: both are the downloaded library, cut the same way.
 * A "plan" (movieRowPlan, showRowPlan) is the ordered list of rows a page
 * shows after Trending, each with its whole shelf; the page windows each one
 * to twenty, the shelf page shows all of it, and the shelf's neighbour links
 * are the same list again.
 *
 * The rows cut the library more ways than genre. Every genre row is ordered
 * by popularity, so with genre alone the same twenty well-known titles led
 * Trending, Action, Comedy and Drama alike and the page read as one row
 * repeated. Now arrivals, ratings, decades, keyword collections and a daily
 * shuffle sit among the genres, and spreadRows keeps a title that has already
 * been shown from leading a later row.
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
import { shelfHref, shelfSlug, type Shelf } from "./browseShelfRules";
import {
  alphabetical,
  byPopularity,
  collectionBuckets,
  dailyPicks,
  decadeBuckets,
  decadeLabel,
  genreBuckets,
  hiddenGems,
  inGenre,
  interleave,
  longWatches,
  recentlyAdded,
  ROW_LIMIT,
  shortWatches,
  spreadRows,
  todaySeed,
  topRated,
  MIN_FEATURE_ROW,
} from "./libraryRowRules";
import { COLLECTIONS } from "./libraryCollections";
import { holidayNow, pickHolidayTitles } from "./holidayRules";
import { ANIME_GENRE } from "./animeRules";

/** TMDB's TV genres plus Anime, which only the library can fill (see animeRules.ts). */
async function libraryTVGenres() {
  return [...(await getTVGenres()), ANIME_GENRE];
}

/**
 * The movie genres that lead, in this order: the five the pages have always
 * opened with, and Western. Home shows only these; Movies follows them with
 * every other genre that has something downloaded.
 */
const LEAD_MOVIE_GENRES = [28, 35, 18, 27, 878, 37]; // Action, Comedy, Drama, Horror, Sci-Fi, Western

/**
 * How many collection and decade rows a tab page deals in among the genres.
 * Enough for variety; not so many that the page is forty rows of twenty tiles.
 */
const TAB_COLLECTION_ROWS = 8;
const TAB_DECADE_ROWS = 5;
/** Home shares the page with TV, so it gets a taste of each. */
const HOME_COLLECTION_ROWS = 2;
const HOME_DECADE_ROWS = 1;

/**
 * A bonus row (a collection, a decade, a runtime, Hidden Gems) stays on the
 * page only when at least this many of its tiles are new to it: half a
 * screen's worth. Genre rows and the ordered rows (newest, best, the day's
 * shuffle) are shown whatever they add; see SpreadRow.minFresh.
 */
const MIN_FRESH_ROW = 3;

const FALLBACK_TV_GENRES = 4;
const FALLBACK_ROW_SIZE = 8;

export type MovieRowData = { title: string; href: string; movies: Movie[] };
export type ShowRowData = { title: string; href: string; shows: TVShow[] };

// Keywords and arrival dates are for building rows, not for the browser: a
// title's keywords can run to thirty strings, sent once per row it appears in.
function movieCard(movie: LibraryMovie): Movie {
  const { keywords: _keywords, addedAt: _addedAt, ...card } = movie;
  return card;
}

function showCard(show: LibraryShow): TVShow {
  const { keywords: _keywords, addedAt: _addedAt, ...card } = show;
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

const ALL_MOVIES = "All Movies";
const ALL_SHOWS = "All TV Shows";
const RECENT = "Recently Added";
const PICKS = "Today's Picks";
const TOP_RATED = "Top Rated";
const HIDDEN_GEMS = "Hidden Gems";
const SHORT = "Under 95 Minutes";
const LONG = "Epics";

/** Every shelf but the viewer's own list, which is theirs and not the library's. */
type LibraryShelf = Exclude<Shelf, { kind: "my-list" }>;

/** One row with its whole shelf, before the page windows it. */
type PlannedRow<T> = { shelf: LibraryShelf; title: string; titles: T[]; minFresh?: number };

type Genre = { id: number; name: string };

/** A row only when it has enough in it to be worth a heading. */
function featureRow<T>(shelf: LibraryShelf, title: string, titles: T[], minFresh = 0): PlannedRow<T>[] {
  return titles.length >= MIN_FEATURE_ROW ? [{ shelf, title, titles, minFresh }] : [];
}

/** `a` and `b` taken turn about, then the rest of the longer one. */
function alternate<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/**
 * The rows that cut across genre. `lead` goes straight after Trending: what
 * is new. `among` are dealt in between the genre rows, an ordered row (best,
 * the day's shuffle, Hidden Gems) turn about with a collection or a decade.
 * The cuts must earn their place (see MIN_FRESH_ROW), since a small library
 * has shown most of itself a few rows down. Shared by movies and shows; the
 * movie plan adds its runtime rows.
 */
function crossRows<T extends LibraryMovie | LibraryShow>(
  library: T[],
  seed: string,
  caps: { collections: number; decades: number }
): { lead: PlannedRow<T>[]; among: PlannedRow<T>[] } {
  const lead = featureRow<T>({ kind: "recent" }, RECENT, recentlyAdded(library));
  const collections: PlannedRow<T>[] = collectionBuckets(library, COLLECTIONS)
    .slice(0, caps.collections)
    .map((b) => ({
      shelf: { kind: "collection", slug: b.collection.slug },
      title: b.collection.title,
      titles: b.titles,
      minFresh: MIN_FRESH_ROW,
    }));
  const decades: PlannedRow<T>[] = decadeBuckets(library)
    .slice(0, caps.decades)
    .map((b) => ({
      shelf: { kind: "decade", decade: b.decade },
      title: decadeLabel(b.decade),
      titles: b.titles,
      minFresh: MIN_FRESH_ROW,
    }));
  const ordered = [
    ...featureRow<T>({ kind: "top-rated" }, TOP_RATED, topRated(library)),
    ...featureRow<T>({ kind: "picks" }, PICKS, dailyPicks(library, seed)),
    ...featureRow<T>({ kind: "hidden-gems" }, HIDDEN_GEMS, hiddenGems(library), MIN_FRESH_ROW),
  ];
  return { lead, among: alternate(ordered, alternate(collections, decades)) };
}

/**
 * Every row the Movies tab shows after Trending, with its whole shelf. `home`
 * keeps to the lead genres and fewer cross rows, for Home, where movies share
 * the page with TV.
 */
function movieRowPlan(library: LibraryMovie[], genres: Genre[], home: boolean, seed = todaySeed()): PlannedRow<LibraryMovie>[] {
  const genreRows: PlannedRow<LibraryMovie>[] = genreBuckets(library, genres, LEAD_MOVIE_GENRES)
    .filter((b) => !home || LEAD_MOVIE_GENRES.includes(b.genre.id))
    .map((b) => ({ shelf: { kind: "genre", genreId: b.genre.id }, title: b.genre.name, titles: b.titles }));
  const { lead, among } = crossRows(library, seed, {
    collections: home ? HOME_COLLECTION_ROWS : TAB_COLLECTION_ROWS,
    decades: home ? HOME_DECADE_ROWS : TAB_DECADE_ROWS,
  });
  const runtime = home
    ? []
    : [
        ...featureRow<LibraryMovie>({ kind: "short" }, SHORT, shortWatches(library), MIN_FRESH_ROW),
        ...featureRow<LibraryMovie>({ kind: "long" }, LONG, longWatches(library), MIN_FRESH_ROW),
      ];
  return [...lead, ...interleave(genreRows, [...among, ...runtime])];
}

/** The TV twin. Home shows only what is new, and leaves the rest to the tab. */
function showRowPlan(library: LibraryShow[], genres: Genre[], home: boolean, seed = todaySeed()): PlannedRow<LibraryShow>[] {
  if (home) return featureRow<LibraryShow>({ kind: "recent" }, RECENT, recentlyAdded(library));
  const genreRows: PlannedRow<LibraryShow>[] = genreBuckets(library, genres).map((b) => ({
    shelf: { kind: "genre", genreId: b.genre.id },
    title: b.genre.name,
    titles: b.titles,
  }));
  const { lead, among } = crossRows(library, seed, { collections: TAB_COLLECTION_ROWS, decades: TAB_DECADE_ROWS });
  return [...lead, ...interleave(genreRows, among)];
}

export type MovieBrowse = {
  trending: Movie[];
  /** Everything downloaded, A to Z. Null when the rows are TMDB's, not the library's. */
  all: MovieRowData | null;
  /** The holiday in season, when the library has anything for it. */
  holiday: MovieRowData | null;
  /** Every row after Trending, in page order: genres and the rows among them. */
  rows: MovieRowData[];
};

/** `home` keeps to the lead genres and fewer cross rows, for Home, where movies share the page. */
export async function getMovieBrowse({ home = false }: { home?: boolean } = {}): Promise<MovieBrowse> {
  const [library, genres] = await Promise.all([movieLibrary(), getGenres()]);

  if (!library) {
    const [trending, lists] = await Promise.all([
      getTrending(10),
      Promise.all(LEAD_MOVIE_GENRES.map((id) => getDiscoverByGenre(id, FALLBACK_ROW_SIZE))),
    ]);
    return {
      trending,
      all: null,
      holiday: null,
      rows: LEAD_MOVIE_GENRES.map((id, i) => ({
        title: genres.find((g) => g.id === id)?.name ?? "Genre",
        href: shelfHref("movies", { kind: "genre", genreId: id }),
        movies: lists[i] ?? [],
      })),
    };
  }

  const holiday = holidayNow();
  const holidayMovies = holiday ? pickHolidayTitles(holiday, library) : [];
  const plan = movieRowPlan(library, genres, home);

  // Page order, so a title leads the first row it belongs to and sinks in the
  // rest: the holiday row keeps its own, Trending keeps what is left of the
  // top, and every row below leads with what the rows above did not show. A
  // bonus row that cannot is left off the page.
  const [holidayWindow, trendingWindow, ...windows] = spreadRows([{ titles: holidayMovies }, { titles: library }, ...plan]);

  return {
    trending: trendingWindow.map(movieCard),
    all: {
      title: ALL_MOVIES,
      href: shelfHref("movies", { kind: "all" }),
      movies: alphabetical(library, (m) => m.title).slice(0, ROW_LIMIT).map(movieCard),
    },
    holiday:
      holiday && holidayMovies.length > 0
        ? { title: holiday.title, href: shelfHref("movies", { kind: "holiday" }), movies: holidayWindow.map(movieCard) }
        : null,
    rows: plan
      .map((row, i) => ({ title: row.title, href: shelfHref("movies", row.shelf), movies: windows[i].map(movieCard) }))
      .filter((row) => row.movies.length > 0),
  };
}

export type ShowBrowse = {
  trending: TVShow[];
  all: ShowRowData | null;
  holiday: ShowRowData | null;
  rows: ShowRowData[];
};

/** `home` keeps to the one row Home has room for under Trending TV. */
export async function getShowBrowse({ home = false }: { home?: boolean } = {}): Promise<ShowBrowse> {
  const library = await showLibrary();

  if (!library) {
    const trending = getTrendingTV(10);
    if (home) return { trending: await trending, all: null, holiday: null, rows: [] };
    const genres = (await getTVGenres()).slice(0, FALLBACK_TV_GENRES);
    const lists = await Promise.all(genres.map((g) => getDiscoverTVByGenre(g.id, FALLBACK_ROW_SIZE)));
    return {
      trending: await trending,
      all: null,
      holiday: null,
      rows: genres.map((g, i) => ({
        title: g.name,
        href: shelfHref("tv", { kind: "genre", genreId: g.id }),
        shows: lists[i] ?? [],
      })),
    };
  }

  const holiday = holidayNow();
  const holidayShows = holiday ? pickHolidayTitles(holiday, library) : [];
  const plan = showRowPlan(library, home ? [] : await libraryTVGenres(), home);
  const [holidayWindow, trendingWindow, ...windows] = spreadRows([{ titles: holidayShows }, { titles: library }, ...plan]);

  return {
    trending: trendingWindow.map(showCard),
    all: {
      title: ALL_SHOWS,
      href: shelfHref("tv", { kind: "all" }),
      shows: alphabetical(library, (s) => s.name).slice(0, ROW_LIMIT).map(showCard),
    },
    holiday:
      holiday && holidayShows.length > 0
        ? { title: holiday.title, href: shelfHref("tv", { kind: "holiday" }), shows: holidayWindow.map(showCard) }
        : null,
    rows: plan
      .map((row, i) => ({ title: row.title, href: shelfHref("tv", row.shelf), shows: windows[i].map(showCard) }))
      .filter((row) => row.shows.length > 0),
  };
}

/** One shelf in full. `paged` is true only for TMDB's lists, which grow with "Load more". */
export type ShelfContents<T> = { title: string; items: T[]; paged: boolean };

/** The planned row a shelf names, or null when today's plan has no such row. */
function planned<T>(plan: PlannedRow<T>[], shelf: LibraryShelf): PlannedRow<T> | null {
  const slug = shelfSlug(shelf);
  return plan.find((row) => shelfSlug(row.shelf) === slug) ?? null;
}

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

  // The remaining shelves exist only over the library.
  if (!library) return null;
  if (shelf.kind === "all") {
    return { title: ALL_MOVIES, items: alphabetical(library, (m) => m.title).map(movieCard), paged: false };
  }

  if (shelf.kind === "holiday") {
    // The holiday shelf exists only in season.
    const holiday = holidayNow();
    if (!holiday) return null;
    return { title: holiday.title, items: pickHolidayTitles(holiday, library).map(movieCard), paged: false };
  }

  const row = planned(movieRowPlan(library, genres, false), shelf);
  return row ? { title: row.title, items: row.titles.map(movieCard), paged: false } : null;
}

export async function getShowShelf(shelf: LibraryShelf, pages: number): Promise<ShelfContents<TVShow> | null> {
  const [library, genres] = await Promise.all([showLibrary(), libraryTVGenres()]);

  if (shelf.kind === "genre") {
    const genre = genres.find((g) => g.id === shelf.genreId);
    if (!genre) return null;
    // TMDB cannot discover by a genre it does not have.
    if (!library && genre.id === ANIME_GENRE.id) return null;
    return library
      ? { title: genre.name, items: inGenre(library, genre.name).map(showCard), paged: false }
      : { title: genre.name, items: await getDiscoverTVByGenrePages(genre.id, pages), paged: true };
  }

  if (shelf.kind === "trending") {
    return library
      ? { title: "Trending TV", items: library.map(showCard), paged: false }
      : { title: "Trending TV", items: await getTrendingTVPages(pages), paged: true };
  }

  if (!library) return null;
  if (shelf.kind === "all") {
    return { title: ALL_SHOWS, items: alphabetical(library, (s) => s.name).map(showCard), paged: false };
  }

  if (shelf.kind === "holiday") {
    const holiday = holidayNow();
    if (!holiday) return null;
    return { title: holiday.title, items: pickHolidayTitles(holiday, library).map(showCard), paged: false };
  }

  const row = planned(showRowPlan(library, genres, false), shelf);
  return row ? { title: row.title, items: row.titles.map(showCard), paged: false } : null;
}

export type ShelfLink = { shelf: Shelf; label: string };

/**
 * The shelves worth offering beside the one being read: every row in the tab
 * page's plan, so a genre with nothing downloaded is not offered as somewhere
 * to go. A row the page left off for adding too little is still a shelf, and
 * this is where it is reached.
 */
export async function getMovieShelfLinks(): Promise<ShelfLink[]> {
  const [library, genres] = await Promise.all([movieLibrary(), getGenres()]);
  const holiday = holidayNow();
  const offered: ShelfLink[] = library
    ? movieRowPlan(library, genres, false).map((row) => ({ shelf: row.shelf, label: row.title }))
    : genres.map((g) => ({ shelf: { kind: "genre" as const, genreId: g.id }, label: g.name }));
  return [
    ...(library ? [{ shelf: { kind: "all" as const }, label: ALL_MOVIES }] : []),
    { shelf: { kind: "trending" }, label: "Trending Now" },
    ...(holiday && library && pickHolidayTitles(holiday, library).length > 0
      ? [{ shelf: { kind: "holiday" as const }, label: holiday.title }]
      : []),
    ...offered,
  ];
}

export async function getShowShelfLinks(): Promise<ShelfLink[]> {
  const [library, genres] = await Promise.all([showLibrary(), getTVGenres()]);
  const holiday = holidayNow();
  const offered: ShelfLink[] = library
    ? showRowPlan(library, [...genres, ANIME_GENRE], false).map((row) => ({ shelf: row.shelf, label: row.title }))
    : genres.map((g) => ({ shelf: { kind: "genre" as const, genreId: g.id }, label: g.name }));
  return [
    ...(library ? [{ shelf: { kind: "all" as const }, label: ALL_SHOWS }] : []),
    { shelf: { kind: "trending" }, label: "Trending TV" },
    ...(holiday && library && pickHolidayTitles(holiday, library).length > 0
      ? [{ shelf: { kind: "holiday" as const }, label: holiday.title }]
      : []),
    ...offered,
  ];
}
