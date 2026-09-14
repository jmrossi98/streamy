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
  developer: string;
  description: string;
  tags: string[];
  fileName: string;
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

/** Rows below this aren't worth their own heading -- they fold into Everything. */
const MIN_ROW_SIZE = 3;
/** Tags that describe bookkeeping rather than a genre anyone browses by. */
const NON_GENRE_TAGS = new Set(["auto-zipped", "unsorted", "untagged"]);

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
 * Groups games into the tab's rows.
 *
 * Pure, so it tests without a database.
 *
 * Tags come from Flashpoint and are genuinely uneven -- a game can carry six,
 * or none. So a game appears in every row it qualifies for rather than being
 * forced into one, small tags fold into a catch-all instead of producing rows
 * of one, and the catch-all is always present so a library with no tags at all
 * still renders something.
 */
export function buildRows(
  games: FlashGameSummary[],
  /** Slugs on this viewer's My List. Pinned as the first row when non-empty. */
  myListSlugs: ReadonlySet<string> = new Set()
): FlashGameRow[] {
  // My List first, always. It is the row someone came for, and burying it
  // under whichever genre happens to be biggest makes it useless.
  const pinned: FlashGameRow[] = [];
  if (myListSlugs.size > 0) {
    const mine = games.filter((g) => myListSlugs.has(g.slug));
    if (mine.length > 0) pinned.push({ key: "my-list", title: "My List", games: mine });
  }

  const byTag = new Map<string, FlashGameSummary[]>();
  for (const game of games) {
    for (const tag of game.tags) {
      const key = tag.toLowerCase();
      if (NON_GENRE_TAGS.has(key)) continue;
      const list = byTag.get(tag) ?? [];
      list.push(game);
      byTag.set(tag, list);
    }
  }

  const rows: FlashGameRow[] = [...byTag.entries()]
    .filter(([, list]) => list.length >= MIN_ROW_SIZE)
    // Biggest first, then alphabetical -- a stable order, and the rows someone
    // is most likely to want are nearest the top.
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([tag, list]) => ({ key: `tag:${tag}`, title: tag, games: list }));

  if (games.length > 0) {
    rows.push({ key: "all", title: "All Games", games });
  }
  return [...pinned, ...rows];
}
