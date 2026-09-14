/**
 * The Flash games library as the Games tab sees it.
 *
 * Sits above the two lower-level clients: flashLibrary.ts (the SWF bytes on
 * mediabox) and flashpoint.ts (the catalogue metadata). Neither of those knows
 * about the database; this is where a file on disk becomes a row, and rows
 * become the tab's rows.
 */

import { prisma } from "./db";
import { fetchFlashFile, listFlashFiles } from "./flashLibrary";
import { parseSwfMetadata } from "./swfMetadata";

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
export function buildRows(games: FlashGameSummary[]): FlashGameRow[] {
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
  return rows;
}

function toSummary(row: {
  slug: string; title: string; developer: string; description: string;
  tags: string; fileName: string; width: number; height: number;
  isActionScript3: boolean;
}): FlashGameSummary {
  return { ...row, tags: parseTags(row.tags) };
}

export async function listFlashGames(): Promise<FlashGameSummary[]> {
  const rows = await prisma.flashGame.findMany({ orderBy: { title: "asc" } });
  return rows.map(toSummary);
}

export async function getFlashGame(slug: string): Promise<FlashGameSummary | null> {
  const row = await prisma.flashGame.findUnique({ where: { slug } });
  return row ? toSummary(row) : null;
}

export type SyncResult = { added: string[]; skipped: string[] };

/**
 * Brings the catalogue in line with what's actually on mediabox.
 *
 * Additive only. A row whose file has disappeared is left alone: the library
 * is reached over Tailscale, so "no files visible" is far more often a
 * sleeping mediabox than a deleted game, and deleting the catalogue every time
 * the tunnel blinks is the same mistake that once wiped 187 Steam shortcuts.
 *
 * Each new file is fetched once so its header can be read -- that is what
 * makes the player size correct and the AS3 warning possible before anyone
 * clicks. A file that won't parse is skipped rather than added blind.
 */
export async function syncFlashLibrary(): Promise<SyncResult> {
  const files = await listFlashFiles();
  const added: string[] = [];
  const skipped: string[] = [];
  if (files.length === 0) return { added, skipped };

  const known = new Set(
    (await prisma.flashGame.findMany({ select: { fileName: true } })).map((g) => g.fileName)
  );

  for (const file of files) {
    if (known.has(file.name)) continue;

    const buffer = await fetchFlashFile(file.name);
    const meta = buffer ? parseSwfMetadata(buffer) : null;
    if (!meta) {
      // Not a SWF, an LZMA body Node can't inflate, or mediabox went away
      // mid-sync. Skipping leaves it to be picked up by the next run.
      skipped.push(file.name);
      continue;
    }

    // Collisions are real: "Game (1).swf" and "game 1.swf" slug identically.
    let slug = slugFromFileName(file.name);
    for (let n = 2; await prisma.flashGame.findUnique({ where: { slug } }); n++) {
      slug = `${slugFromFileName(file.name)}-${n}`;
    }

    await prisma.flashGame.create({
      data: {
        slug,
        title: titleFromFileName(file.name),
        fileName: file.name,
        fileSize: file.size,
        width: meta.width,
        height: meta.height,
        frameRate: meta.frameRate,
        swfVersion: meta.swfVersion,
        isActionScript3: meta.isActionScript3,
      },
    });
    added.push(slug);
  }

  return { added, skipped };
}
