/**
 * The Flash games library as the Games tab sees it.
 *
 * Sits above the two lower-level clients: flashLibrary.ts (the SWF bytes on
 * mediabox) and flashpoint.ts (the catalogue metadata). Neither of those knows
 * about the database; this is where a file on disk becomes a row.
 *
 * Everything here touches Prisma, which is exactly why the naming and
 * row-building rules live in flashGameRules.ts instead: CI's unit-test step
 * runs `npm ci --ignore-scripts`, so the Prisma client does not exist there and
 * importing this file from a test fails outright.
 */

import { prisma } from "./db";
import { fetchFlashFile, listFlashFiles } from "./flashLibrary";
import { parseSwfMetadata } from "./swfMetadata";
import {
  parseTags,
  slugFromFileName,
  titleFromFileName,
  type FlashGameSummary,
} from "./flashGameRules";

// Re-exported so callers have one import for the library, even though the
// pure half has to live in its own file to stay testable.
export * from "./flashGameRules";

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
