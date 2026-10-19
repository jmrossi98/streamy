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
  type PersonTitle,
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

/** `total` is how many the shelf behind the heading holds; null when it is TMDB's paged list. */
export type MovieRowData = { title: string; href: string; movies: Movie[]; total: number | null };
export type ShowRowData = { title: string; href: string; shows: TVShow[]; total: number | null };

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
  // Home's Recently Added row mixes both kinds (getHomeMixedRows), so the
  // movie-only one stays on the Movies tab.
  return [...(home ? [] : lead), ...interleave(genreRows, [...among, ...runtime])];
}

/** The TV twin. Home has no TV rows of its own: what is new is in the mixed row. */
function showRowPlan(library: LibraryShow[], genres: Genre[], home: boolean, seed = todaySeed()): PlannedRow<LibraryShow>[] {
  if (home) return [];
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
  /** How many the Trending shelf holds: the whole library, or null for TMDB's list. */
  trendingTotal: number | null;
  /** Everything downloaded, A to Z. Null when the rows are TMDB's, not the library's. */
  all: MovieRowData | null;
  /** The holiday in season, when the library has anything for it. */
  holiday: MovieRowData | null;
  /** Every row after Trending, in page order: genres and the rows among them. */
  rows: MovieRowData[];
};

type BrowseOptions = {
  /** Home: the lead genres and fewer cross rows, and no holiday or Recently Added row (those mix kinds there). */
  home?: boolean;
  /** Ids already leading a row elsewhere on the page, which these rows then avoid leading with. */
  alreadyShown?: Iterable<string>;
};

export async function getMovieBrowse({ home = false, alreadyShown = [] }: BrowseOptions = {}): Promise<MovieBrowse> {
  const [library, genres] = await Promise.all([movieLibrary(), getGenres()]);

  if (!library) {
    const [trending, lists] = await Promise.all([
      getTrending(10),
      Promise.all(LEAD_MOVIE_GENRES.map((id) => getDiscoverByGenre(id, FALLBACK_ROW_SIZE))),
    ]);
    return {
      trending,
      trendingTotal: null,
      all: null,
      holiday: null,
      rows: LEAD_MOVIE_GENRES.map((id, i) => ({
        title: genres.find((g) => g.id === id)?.name ?? "Genre",
        href: shelfHref("movies", { kind: "genre", genreId: id }),
        movies: lists[i] ?? [],
        total: null,
      })),
    };
  }

  const holiday = holidayNow();
  const holidayMovies = holiday && !home ? pickHolidayTitles(holiday, library) : [];
  const plan = movieRowPlan(library, genres, home);

  // Page order, so a title leads the first row it belongs to and sinks in the
  // rest: the holiday row keeps its own, Trending keeps what is left of the
  // top, and every row below leads with what the rows above did not show. A
  // bonus row that cannot is left off the page.
  const [holidayWindow, trendingWindow, ...windows] = spreadRows(
    [{ titles: holidayMovies }, { titles: library }, ...plan],
    ROW_LIMIT,
    alreadyShown
  );

  return {
    trending: trendingWindow.map(movieCard),
    trendingTotal: library.length,
    all: {
      title: ALL_MOVIES,
      href: shelfHref("movies", { kind: "all" }),
      movies: alphabetical(library, (m) => m.title).slice(0, ROW_LIMIT).map(movieCard),
      total: library.length,
    },
    holiday:
      holiday && holidayMovies.length > 0
        ? {
            title: holiday.title,
            href: shelfHref("movies", { kind: "holiday" }),
            movies: holidayWindow.map(movieCard),
            total: holidayMovies.length,
          }
        : null,
    rows: plan
      .map((row, i) => ({
        title: row.title,
        href: shelfHref("movies", row.shelf),
        movies: windows[i].map(movieCard),
        total: row.titles.length,
      }))
      .filter((row) => row.movies.length > 0),
  };
}

export type ShowBrowse = {
  trending: TVShow[];
  trendingTotal: number | null;
  all: ShowRowData | null;
  holiday: ShowRowData | null;
  rows: ShowRowData[];
};

export async function getShowBrowse({ home = false, alreadyShown = [] }: BrowseOptions = {}): Promise<ShowBrowse> {
  const library = await showLibrary();

  if (!library) {
    const trending = getTrendingTV(10);
    if (home) return { trending: await trending, trendingTotal: null, all: null, holiday: null, rows: [] };
    const genres = (await getTVGenres()).slice(0, FALLBACK_TV_GENRES);
    const lists = await Promise.all(genres.map((g) => getDiscoverTVByGenre(g.id, FALLBACK_ROW_SIZE)));
    return {
      trending: await trending,
      trendingTotal: null,
      all: null,
      holiday: null,
      rows: genres.map((g, i) => ({
        title: g.name,
        href: shelfHref("tv", { kind: "genre", genreId: g.id }),
        shows: lists[i] ?? [],
        total: null,
      })),
    };
  }

  const holiday = holidayNow();
  const holidayShows = holiday && !home ? pickHolidayTitles(holiday, library) : [];
  const plan = showRowPlan(library, home ? [] : await libraryTVGenres(), home);
  const [holidayWindow, trendingWindow, ...windows] = spreadRows(
    [{ titles: holidayShows }, { titles: library }, ...plan],
    ROW_LIMIT,
    alreadyShown
  );

  return {
    trending: trendingWindow.map(showCard),
    trendingTotal: library.length,
    all: {
      title: ALL_SHOWS,
      href: shelfHref("tv", { kind: "all" }),
      shows: alphabetical(library, (s) => s.name).slice(0, ROW_LIMIT).map(showCard),
      total: library.length,
    },
    holiday:
      holiday && holidayShows.length > 0
        ? {
            title: holiday.title,
            href: shelfHref("tv", { kind: "holiday" }),
            shows: holidayWindow.map(showCard),
            total: holidayShows.length,
          }
        : null,
    rows: plan
      .map((row, i) => ({
        title: row.title,
        href: shelfHref("tv", row.shelf),
        shows: windows[i].map(showCard),
        total: row.titles.length,
      }))
      .filter((row) => row.shows.length > 0),
  };
}

// ---------------------------------------------------------------------------
// Home's mixed rows: Recently Added and the holiday across movies and shows.
// Home used to show each by kind, "Recently Added - Movies" and "- Shows"; one
// row per cut is how the viewer reads the page, the way My List and Continue
// Watching already mix kinds. The Movies and TV tabs keep the single-kind rows.
// ---------------------------------------------------------------------------

export const MIXED_SHELVES = ["recent", "holiday"] as const;
export type MixedShelfKind = (typeof MIXED_SHELVES)[number];

export function mixedShelfHref(kind: MixedShelfKind): string {
  return `/browse/${kind}`;
}

export type MixedRowData = { title: string; href: string; items: PersonTitle[]; total: number };

/** A library title of either kind, keyed so the two kinds' ids cannot collide. */
type MixedTitle = {
  id: string;
  addedAt: string | null;
  keywords: string[];
  genres: string[];
  popularity?: number;
  card: PersonTitle;
};

async function mixedLibrary(): Promise<MixedTitle[] | null> {
  const [movies, shows] = await Promise.all([movieLibrary(), showLibrary()]);
  if (!movies && !shows) return null;
  return [
    ...(movies ?? []).map((m) => ({
      id: `movie:${m.id}`,
      addedAt: m.addedAt,
      keywords: m.keywords,
      genres: m.genres,
      popularity: m.popularity,
      card: { kind: "movie" as const, movie: movieCard(m) },
    })),
    ...(shows ?? []).map((s) => ({
      id: `show:${s.id}`,
      addedAt: s.addedAt,
      keywords: s.keywords,
      genres: s.genres,
      popularity: s.popularity,
      card: { kind: "show" as const, show: showCard(s) },
    })),
  ];
}

/** The whole of each mixed shelf, in row order; holiday is empty out of season. */
function mixedShelves(library: MixedTitle[]): { recent: MixedTitle[]; holiday: MixedTitle[]; holidayTitle: string | null } {
  const holiday = holidayNow();
  return {
    recent: recentlyAdded(library),
    holiday: holiday ? pickHolidayTitles(holiday, library) : [],
    holidayTitle: holiday?.title ?? null,
  };
}

export type HomeMixedRows = {
  recent: MixedRowData | null;
  holiday: MixedRowData | null;
  /** The movie and show ids these rows lead with, for the per-kind rows to avoid. */
  movieIds: string[];
  showIds: string[];
};

/** Home's two mixed rows, windowed. Null rows when the library cannot be read (the TMDB fallback has no arrivals). */
export async function getHomeMixedRows(): Promise<HomeMixedRows> {
  const library = await mixedLibrary();
  if (!library) return { recent: null, holiday: null, movieIds: [], showIds: [] };
  const shelves = mixedShelves(library);
  // The holiday row sits above Recently Added on the page, so it keeps its own.
  const [holidayWindow, recentWindow] = spreadRows([{ titles: shelves.holiday }, { titles: shelves.recent }]);
  const shown = [...holidayWindow, ...recentWindow];
  return {
    recent:
      recentWindow.length > 0
        ? { title: RECENT, href: mixedShelfHref("recent"), items: recentWindow.map((t) => t.card), total: shelves.recent.length }
        : null,
    holiday:
      shelves.holidayTitle && holidayWindow.length > 0
        ? {
            title: shelves.holidayTitle,
            href: mixedShelfHref("holiday"),
            items: holidayWindow.map((t) => t.card),
            total: shelves.holiday.length,
          }
        : null,
    movieIds: shown.filter((t) => t.card.kind === "movie").map((t) => t.id.slice("movie:".length)),
    showIds: shown.filter((t) => t.card.kind === "show").map((t) => t.id.slice("show:".length)),
  };
}

export type MixedShelfContents = {
  title: string;
  items: PersonTitle[];
  /** The other mixed shelf, when it has anything today. */
  others: { kind: MixedShelfKind; title: string }[];
};

/** Everything on one of Home's mixed shelves, or null when there is no such shelf today. */
export async function getMixedShelf(kind: MixedShelfKind): Promise<MixedShelfContents | null> {
  const library = await mixedLibrary();
  if (!library) return null;
  const shelves = mixedShelves(library);
  const holidayShelf = shelves.holidayTitle ? { kind: "holiday" as const, title: shelves.holidayTitle } : null;
  if (kind === "recent") {
    return {
      title: RECENT,
      items: shelves.recent.map((t) => t.card),
      others: holidayShelf && shelves.holiday.length > 0 ? [holidayShelf] : [],
    };
  }
  if (!holidayShelf || shelves.holiday.length === 0) return null;
  return { title: holidayShelf.title, items: shelves.holiday.map((t) => t.card), others: [{ kind: "recent", title: RECENT }] };
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
