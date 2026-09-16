/**
 * Flash game rules: naming, tag parsing, and how the tab's rows are built.
 *
 * Pure, and split from flashGames.ts for the reason that file's database
 * imports make unavoidable: CI's unit-test step runs `npm ci --ignore-scripts`
 * on purpose, so the Prisma client is never generated there. Anything a test
 * touches has to be reachable without it -- same split as pageWatchRules vs
 * pageWatch, and chatContext vs chatStatus.
 */

export type FlashGameSummary = {
  slug: string;
  title: string;
  /** Set when the game came from Flashpoint; null for a hand-added SWF. */
  flashpointId: string | null;
  /** Andkon's "category/slug", when it came from there. Also the art fallback. */
  andkonPath: string | null;
  developer: string;
  description: string;
  tags: string[];
  /** Null when the game is known but not downloaded yet. */
  fileName: string | null;
  /** Whether it can actually be played right now. */
  playable: boolean;
  width: number;
  height: number;
  /** Ruffle's weak spot -- the UI warns before someone clicks. */
  isActionScript3: boolean;
};

/** Rows on the tab. `title` is the heading; `key` is stable for React. */
export type FlashGameRow = {
  key: string;
  title: string;
  games: FlashGameSummary[];
};

/**
 * Filename stem -> URL-safe identity.
 *
 * Deliberately derived from the filename rather than the title: the file is
 * the one thing guaranteed to exist (a hand-dropped SWF has no title until
 * someone types one), and it keeps the slug stable if the title is later
 * edited.
 */
export function slugFromFileName(fileName: string): string {
  return fileName
    .replace(/\.swf$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "game";
}

/**
 * A readable title from a filename, for a SWF nobody has named.
 *
 * Same job as the ROM side's clean_label: strip the extension, turn separators
 * into spaces, and title-case what's left. It is a guess, and the point is
 * that it's an editable one rather than showing someone "thegamegame.swf".
 */
export function titleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.swf$/i, "").replace(/[_-]+/g, " ").trim();
  if (!stem) return fileName;
  return stem
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function parseTags(tags: string): string[] {
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

/**
 * The viewer's own row, above the browsable shelves.
 *
 * Pure, so it tests without a database.
 *
 * Just My List now. This used to also emit a row per Flashpoint tag across
 * whatever happened to be downloaded, which produced a wall of near-duplicate
 * shelves ("Action", "Arcade", "Platformer"...) built from a handful of games,
 * sitting above the real genre shelves and pushing them off the screen. The
 * genres are the catalogue's job; this is only "the games you saved".
 *
 * Returns an array rather than a single row so the caller stays the same
 * shape, and so an empty list renders nothing at all instead of an empty
 * heading.
 */
export function buildRows(
  games: FlashGameSummary[],
  /** Slugs on this viewer's My List. */
  myListSlugs: ReadonlySet<string> = new Set()
): FlashGameRow[] {
  if (myListSlugs.size === 0) return [];
  const mine = games.filter((g) => myListSlugs.has(g.slug));
  return mine.length > 0 ? [{ key: "my-list", title: "My List", games: mine }] : [];
}
