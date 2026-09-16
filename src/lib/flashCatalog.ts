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
  /** Flashpoint id, absent when only Andkon has this game. */
  i?: string;
  /** Title. */
  t: string;
  /** Developer, absent when unknown. */
  d?: string;
  /** Andkon's "category/slug" path -- the fallback download source. */
  a: string;
  /** 1 when the game is one of Andkon's picks for its category. */
  p?: number;
  /**
   * Rank on Andkon's "games that were once featured" page, oldest first.
   * Absent for the majority of games, which were never front-paged.
   */
  f?: number;
};

type StoredCategory = { key: string; title: string; games: StoredGame[] };

export type CatalogGame = {
  /** Null when Flashpoint has no entry for this game and Andkon is the source. */
  id: string | null;
  andkonPath: string;
  title: string;
  developer: string;
  /** Andkon's own editorial pick for the category -- the popularity signal. */
  pick: boolean;
  /**
   * Rank among the games Andkon has front-paged over the years, oldest first,
   * or null for the majority that never were.
   */
  allTimeRank: number | null;
};

export type CatalogCategory = {
  key: string;
  title: string;
  games: CatalogGame[];
};

function expand(g: StoredGame): CatalogGame {
  return {
    id: g.i ?? null,
    andkonPath: g.a,
    title: g.t,
    developer: g.d || "",
    pick: g.p === 1,
    allTimeRank: g.f ?? null,
  };
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
 * Games are stored in Andkon's own pick order, so taking from the front gives
 * the shelf Andkon hand-arranged. Sorting picks alphabetically instead -- the
 * first version of this -- opened every row with whatever started with a
 * digit: "100% Complete", "30 Seconds", "A Dralien Day".
 */
export function shelfFor(key: string, limit = 24): CatalogGame[] {
  return getCategory(key)?.games.slice(0, limit) ?? [];
}

const BY_FLASHPOINT_ID = new Map<string, CatalogGame>();
const BY_TITLE = new Map<string, CatalogGame>();
for (const category of CATEGORIES) {
  for (const game of category.games) {
    if (game.id && !BY_FLASHPOINT_ID.has(game.id)) BY_FLASHPOINT_ID.set(game.id, game);
    const key = game.title.toLowerCase();
    if (!BY_TITLE.has(key)) BY_TITLE.set(key, game);
  }
}

/**
 * The Andkon path for a game already in the database.
 *
 * Rows created before the catalogue carried Andkon paths -- anything added
 * from a plain Flashpoint search -- have a Flashpoint id and nothing else, so
 * when that id's GameZIP turns out to 404 there is no second source to try.
 * Synapsis and Epic Battle Fantasy were both in exactly that state: present on
 * Andkon the whole time, unreachable here because the row didn't know it.
 *
 * Matched on the Flashpoint id first, then on an exact title. Title matching
 * is deliberately exact: "Epic Battle Fantasy" and "Epic Battle Fantasy 2" are
 * different games, and a fuzzy match here would hand someone the wrong one.
 */
export function findCatalogAndkonPath(
  flashpointId: string | null,
  title: string
): string | null {
  const byId = flashpointId ? BY_FLASHPOINT_ID.get(flashpointId) : undefined;
  if (byId) return byId.andkonPath;
  return BY_TITLE.get(title.trim().toLowerCase())?.andkonPath ?? null;
}

/**
 * Searches the catalogue by title.
 *
 * Runs before -- and alongside -- the Flashpoint search, because the
 * catalogue is the only place roughly half these games exist. Flashpoint has
 * no entry for "The Game Game" or its three sequels, so a Flashpoint-only
 * search could not find them however they were spelled, while Andkon had them
 * the whole time.
 *
 * A linear scan over a few thousand in-memory titles, which is far cheaper
 * than the network call it sits next to.
 *
 * Ranked so that the closest match wins: exact title, then prefix, then
 * anything containing the query. Picks break ties, so a search for "mario"
 * opens with the recognisable ones.
 */
export function searchCatalog(query: string, limit = 40): CatalogGame[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { game: CatalogGame; score: number }[] = [];
  for (const category of CATEGORIES) {
    for (const game of category.games) {
      const title = game.title.toLowerCase();
      const at = title.indexOf(q);
      if (at === -1) continue;
      const score =
        (title === q ? 0 : at === 0 ? 1 : 2) * 10 + (game.pick ? 0 : 1);
      scored.push({ game, score });
    }
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.game.title.length - b.game.title.length ||
      a.game.title.localeCompare(b.game.title)
  );
  return scored.slice(0, limit).map((s) => s.game);
}

/**
 * All-Time Popular.
 *
 * Drawn from Andkon's own "all the great games that were once featured" page
 * -- 258 games it has front-paged over the years -- oldest first, so the row
 * opens on the era-defining end of it: Stick RPG, Fancy Pants Adventure, N,
 * Chaos Faction.
 *
 * The first version of this used the per-category picks instead, which are a
 * current rotation rather than a history, and it showed: the row led with
 * "100% Complete" and "A Dralien Day". Falls back to the picks only if the
 * catalogue somehow carries no featured games at all.
 */
export function allTimePopular(limit = 24): CatalogGame[] {
  const featured = CATEGORIES.flatMap((c) => c.games)
    .filter((g) => g.allTimeRank !== null)
    .sort((a, b) => a.allTimeRank! - b.allTimeRank!);

  if (featured.length > 0) return featured.slice(0, limit);

  // Round-robin across categories, so a bare fallback still spreads rather
  // than draining one shelf.
  const picks = CATEGORIES.map((c) => c.games.filter((g) => g.pick));
  const out: CatalogGame[] = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const list of picks) {
      if (i >= list.length) continue;
      out.push(list[i]);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }
  return out;
}
