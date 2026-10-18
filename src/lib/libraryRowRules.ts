/**
 * Turning the downloaded library into browse rows. Pure.
 *
 * The rows used to be TMDB's idea of a genre: the eight most popular films
 * tagged Action, almost none of which were on disk. Now a row is the part of
 * the library that carries the genre, so every card in it plays.
 */

import { sortKey } from "./shelfFilterRules";

export type RowGenre = { id: number; name: string };

/**
 * TMDB genres that are not a way anyone browses. "TV Movie" describes how a
 * film was released, not what it is.
 */
const NOT_A_SHELF = new Set(["TV Movie"]);

/** Most popular first. Stable for titles with no score. */
export function byPopularity<T extends { popularity?: number }>(titles: T[]): T[] {
  return [...titles].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
}

/** A to Z by the name a title is filed under ("The Matrix" under M). */
export function alphabetical<T>(titles: T[], name: (title: T) => string): T[] {
  return [...titles].sort((a, b) => sortKey(name(a)).localeCompare(sortKey(name(b))));
}

/** The titles carrying a genre, in the order given. */
export function inGenre<T extends { genres: string[] }>(titles: T[], genreName: string): T[] {
  return titles.filter((t) => t.genres.includes(genreName));
}

/**
 * One bucket per genre that has anything in it.
 *
 * A title sits in every genre TMDB gives it, not just the first: a horror
 * comedy is looked for under both, and picking one would hide it from half
 * the people looking. Genres with nothing downloaded produce no bucket, so
 * there are no empty rows to hide later.
 *
 * `lead` genres come first in the order named; the rest follow, fullest
 * first, so the rows nearest the top are the ones with the most to offer.
 */
export function genreBuckets<T extends { genres: string[] }>(
  titles: T[],
  genres: RowGenre[],
  lead: number[] = []
): { genre: RowGenre; titles: T[] }[] {
  const buckets = genres
    .filter((genre) => !NOT_A_SHELF.has(genre.name))
    .map((genre) => ({ genre, titles: inGenre(titles, genre.name) }))
    .filter((bucket) => bucket.titles.length > 0);

  const rank = (id: number) => {
    const at = lead.indexOf(id);
    return at === -1 ? lead.length : at;
  };
  return buckets.sort(
    (a, b) =>
      rank(a.genre.id) - rank(b.genre.id) ||
      b.titles.length - a.titles.length ||
      a.genre.name.localeCompare(b.genre.name)
  );
}

// ---------------------------------------------------------------------------
// Rows beyond genre. The genre rows alone read as one row repeated: every
// row is ordered by popularity, so the same twenty popular titles lead
// Trending, Action, Comedy and Drama alike. These cut the library along other
// lines -- when it arrived, how it is rated, when it was made, what it is
// about -- and `spreadRows` keeps a title from leading more than one row.
// ---------------------------------------------------------------------------

/** A row shows this many; fewer than MIN_FEATURE_ROW is not worth a heading. */
export const ROW_LIMIT = 20;
export const MIN_FEATURE_ROW = 6;

type Identified = { id: string | number };

export type SpreadRow<T> = {
  titles: T[];
  /**
   * The fewest titles this row must add to the page to be shown at all. A
   * row that would be twenty repeats with two new tiles among them is the
   * overlap the viewer complains of; it comes back as an empty window, and
   * the page leaves it out. A row shorter than this is kept when all of it is
   * new. Zero, the default, shows the row whatever it adds -- right for a
   * genre, which is how the library is navigated, and for a row whose order
   * is its content (newest, best, today's shuffle); a bonus cut such as a
   * decade or a keyword collection should earn its place.
   */
  minFresh?: number;
};

/**
 * Cut each row to `limit`, leading with titles no earlier row has shown.
 *
 * Rows are taken in page order. A title already on the page sinks to the end
 * of every later row it belongs to, where it is reached by scrolling rather
 * than seen at once. No row loses a title -- the shelf behind the heading is
 * untouched -- and a row with twenty unseen titles to offer shows twenty new
 * ones. A row with fewer than `limit` candidates keeps them all, seen or not.
 *
 * A row dropped for adding too little (see SpreadRow.minFresh) marks nothing
 * as seen, so the next row gets its chance at the same titles. A library of
 * forty shows cannot fill thirty rows of twenty with anything but repeats;
 * this is how the bonus rows come and go with the size of the library.
 */
export function spreadRows<T extends Identified>(rows: SpreadRow<T>[], limit = ROW_LIMIT): T[][] {
  const seen = new Set<string>();
  return rows.map(({ titles, minFresh = 0 }) => {
    const fresh = titles.filter((t) => !seen.has(String(t.id)));
    const shown = titles.filter((t) => seen.has(String(t.id)));
    if (fresh.length < Math.min(minFresh, titles.length)) return [];
    const window = [...fresh, ...shown].slice(0, limit);
    for (const t of window) seen.add(String(t.id));
    return window;
  });
}

/** Newest arrivals first; titles with no arrival date last, in the order given. */
export function recentlyAdded<T extends { addedAt?: string | null }>(titles: T[]): T[] {
  const dated = titles.filter((t) => t.addedAt) as (T & { addedAt: string })[];
  const undated = titles.filter((t) => !t.addedAt);
  return [...dated.sort((a, b) => b.addedAt.localeCompare(a.addedAt)), ...undated];
}

type Rated = { rating: number; popularity?: number };

/** What counts as well rated: TMDB's 10-point scale, where 7 is already uncommon. */
export const TOP_RATING = 7;

/** Best rated first, the better known one first among equals. */
export function topRated<T extends Rated>(titles: T[], min = TOP_RATING): T[] {
  return titles
    .filter((t) => t.rating >= min)
    .sort((a, b) => b.rating - a.rating || (b.popularity ?? 0) - (a.popularity ?? 0));
}

/**
 * Well rated and little known: the top quarter by popularity is left out, and
 * what remains is ordered by rating, the least known first among equals.
 * Nothing here can lead Trending, which is the point of the row.
 */
export function hiddenGems<T extends Rated>(titles: T[], min = TOP_RATING): T[] {
  const ranked = byPopularity(titles);
  const familiar = new Set(ranked.slice(0, Math.ceil(ranked.length / 4)));
  return ranked
    .filter((t) => !familiar.has(t) && t.rating >= min)
    .sort((a, b) => b.rating - a.rating || (a.popularity ?? 0) - (b.popularity ?? 0));
}

/** The decade a year falls in, as its first year: 1994 -> 1990. Null for no year. */
export function decadeOf(year: string | undefined): number | null {
  const n = Number.parseInt(year ?? "", 10);
  return Number.isFinite(n) && n > 1800 ? Math.floor(n / 10) * 10 : null;
}

/** "'90s" for the decades people say that way; "2000s" and later as written. */
export function decadeLabel(decade: number): string {
  return decade < 2000 ? `'${String(decade).slice(2)}s` : `${decade}s`;
}

/**
 * One bucket per decade with at least `min` titles, fullest first, each in
 * the order the titles came. A title with no year belongs to no decade.
 */
export function decadeBuckets<T extends { year: string }>(
  titles: T[],
  min = MIN_FEATURE_ROW
): { decade: number; titles: T[] }[] {
  const buckets = new Map<number, T[]>();
  for (const t of titles) {
    const decade = decadeOf(t.year);
    if (decade === null) continue;
    buckets.set(decade, [...(buckets.get(decade) ?? []), t]);
  }
  return [...buckets.entries()]
    .filter(([, list]) => list.length >= min)
    .sort(([a, al], [b, bl]) => bl.length - al.length || b - a)
    .map(([decade, list]) => ({ decade, titles: list }));
}

/** A row drawn on TMDB keywords: "Heists" is every title tagged heist or robbery. */
export type Collection = { slug: string; title: string; keywords: string[] };

type Keyworded = { keywords: string[] };

/** The titles carrying any of a collection's keywords, in the order given. */
export function inCollection<T extends Keyworded>(titles: T[], collection: Collection): T[] {
  const wanted = new Set(collection.keywords.map((k) => k.toLowerCase()));
  return titles.filter((t) => t.keywords.some((k) => wanted.has(k.toLowerCase())));
}

/**
 * One bucket per collection with at least `min` titles, in the order the
 * collections are listed -- the list is curated, so its order is deliberate.
 */
export function collectionBuckets<T extends Keyworded>(
  titles: T[],
  collections: Collection[],
  min = MIN_FEATURE_ROW
): { collection: Collection; titles: T[] }[] {
  return collections
    .map((collection) => ({ collection, titles: inCollection(titles, collection) }))
    .filter((b) => b.titles.length >= min);
}

/** Minutes in a "1h 52m" duration, or null when there is none to read. */
export function runtimeMinutes(duration: string | undefined): number | null {
  const m = /^(?:(\d+)h)?\s*(?:(\d+)m)?$/.exec((duration ?? "").trim());
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

/** Done inside an evening; a long sit. */
export const SHORT_RUNTIME_MAX = 95;
export const LONG_RUNTIME_MIN = 150;

export function shortWatches<T extends { duration: string }>(titles: T[]): T[] {
  return titles.filter((t) => {
    const minutes = runtimeMinutes(t.duration);
    return minutes !== null && minutes > 0 && minutes <= SHORT_RUNTIME_MAX;
  });
}

export function longWatches<T extends { duration: string }>(titles: T[]): T[] {
  return titles.filter((t) => (runtimeMinutes(t.duration) ?? 0) >= LONG_RUNTIME_MIN);
}

/** A small, fast, deterministic PRNG (mulberry32) seeded from a string. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The whole library in an order that holds for a day and changes with the
 * next: the same `seed` (a date) gives the same order on every render, so the
 * row is stable while someone looks at it and different when they come back.
 */
export function dailyPicks<T>(titles: T[], seed: string): T[] {
  const random = seededRandom(seed);
  const picks = [...titles];
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks;
}

/** Today as a seed, "2026-10-18": the date, not the time, so a day shares one order. */
export function todaySeed(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * `extras` dealt in among `main`, one after every `every` of the main rows,
 * then whatever is left of either. Genre rows alone run twenty deep without a
 * change of pace; a decade or a collection between them breaks the run.
 */
export function interleave<T>(main: T[], extras: T[], every = 2): T[] {
  const out: T[] = [];
  let e = 0;
  main.forEach((row, i) => {
    out.push(row);
    if ((i + 1) % every === 0 && e < extras.length) out.push(extras[e++]);
  });
  return [...out, ...extras.slice(e)];
}
