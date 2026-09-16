/**
 * The browsable Flash catalogue: which games the Games tab offers, and in what
 * order.
 *
 * Generated offline by scripts/build-flash-catalog.mjs and committed, rather
 * than queried live. The tab used to resolve every shelf title against
 * Flashpoint on each page load -- roughly a hundred searches per view of
 * /games, against a volunteer-run archive, to rebuild identical rows every
 * time. Reading a local file instead makes the page fast, makes it work when
 * the archive is briefly unreachable, and lets the shelves carry thousands of
 * titles instead of a hand-written hundred.
 *
 * Three guarantees come from the generator rather than from anything here:
 * every entry is a Flash game (not a Shockwave port or a `theatre` animation),
 * every entry carries no adult tag, and every entry's GameZIP actually
 * downloaded when it was checked. That last one is why a shelf can no longer
 * offer something that fails at the download step.
 */

import catalog from "./data/flashCatalog.json";

/** One game as stored. Keys are short because there are thousands of them. */
type StoredGame = {
  /** Flashpoint id. */
  i: string;
  /** Title. */
  t: string;
  /** Developer, often empty. */
  d: string;
  /** 1 when the game is one of Andkon's picks for its category. */
  p?: number;
};

type StoredCategory = { key: string; title: string; games: StoredGame[] };

export type CatalogGame = {
  id: string;
  title: string;
  developer: string;
  /** Andkon's own editorial pick for the category -- the popularity signal. */
  pick: boolean;
};

export type CatalogCategory = {
  key: string;
  title: string;
  games: CatalogGame[];
};

function expand(g: StoredGame): CatalogGame {
  return { id: g.i, title: g.t, developer: g.d || "", pick: g.p === 1 };
}

const CATEGORIES: CatalogCategory[] = (catalog.categories as StoredCategory[]).map((c) => ({
  key: c.key,
  title: c.title,
  games: c.games.map(expand),
}));

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** When the committed catalogue was generated. */
export const CATALOG_GENERATED: string = catalog.generated;

export function listCategories(): CatalogCategory[] {
  return CATEGORIES;
}

export function getCategory(key: string): CatalogCategory | null {
  return BY_KEY.get(key) ?? null;
}

export function catalogSize(): number {
  return CATEGORIES.reduce((n, c) => n + c.games.length, 0);
}

/**
 * The first slice of a category, for its shelf on the tab.
 *
 * Games are stored picks-first, so taking from the front gives the
 * recognisable ones rather than whatever sorts alphabetically -- which is how
 * a "Puzzle" shelf ends up opening with something nobody has heard of.
 */
export function shelfFor(key: string, limit = 24): CatalogGame[] {
  return getCategory(key)?.games.slice(0, limit) ?? [];
}

/**
 * All-Time Popular: the picks from every category, interleaved.
 *
 * Round-robin rather than concatenated, so the row opens with a spread across
 * genres instead of the first category's shelf a second time.
 */
export function allTimePopular(limit = 24): CatalogGame[] {
  const picks = CATEGORIES.map((c) => c.games.filter((g) => g.pick));
  const out: CatalogGame[] = [];
  for (let i = 0; out.length < limit; i++) {
    let addedThisPass = false;
    for (const list of picks) {
      if (i >= list.length) continue;
      out.push(list[i]);
      addedThisPass = true;
      if (out.length >= limit) break;
    }
    if (!addedThisPass) break;
  }
  return out;
}
