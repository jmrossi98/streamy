/**
 * Bringing a Flashpoint entry into the local library.
 *
 * Two steps that are easy to conflate: a game becomes *known* (a catalogue row
 * with its metadata) the moment someone shows interest in it, and it becomes
 * *playable* only once its SWF has been fetched. Bookmarking something should
 * not download it, so those happen separately.
 */

import AdmZip from "adm-zip";
import { prisma } from "./db";
import {
  fetchFlashpointAssetDetailed,
  flashpointGameZipUrl,
  pickGameSwf,
  type FlashpointGame,
} from "./flashpoint";
import { slugFromFileName } from "./flashGameRules";
import { storeLocalFile } from "./flashStorage";
import { parseSwfMetadata } from "./swfMetadata";

/** A slug from a title, since an archive entry has no filename to derive one from. */
function slugFromTitle(title: string): string {
  return slugFromFileName(`${title}.swf`);
}

/**
 * Records a Flashpoint entry locally without downloading anything.
 *
 * Called when someone adds an archive game to their list. The row carries the
 * metadata and no file, which is what fileName being nullable is for.
 *
 * Idempotent on flashpointId, so adding the same game twice -- from two
 * different rows, or by two people -- reuses the row rather than creating a
 * second one under a suffixed slug.
 */
export async function ensureKnownGame(game: FlashpointGame): Promise<string> {
  const existing = await prisma.flashGame.findUnique({
    where: { flashpointId: game.id },
    select: { slug: true },
  });
  if (existing) return existing.slug;

  let slug = slugFromTitle(game.title);
  for (let n = 2; await prisma.flashGame.findUnique({ where: { slug } }); n++) {
    slug = `${slugFromTitle(game.title)}-${n}`;
  }

  await prisma.flashGame.create({
    data: {
      slug,
      title: game.title,
      flashpointId: game.id,
      developer: game.developer,
      publisher: game.publisher,
      description: game.description,
      releaseDate: game.releaseDate,
      tags: game.tags.join(", "),
    },
  });
  return slug;
}

export type ImportResult =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/**
 * Fetches a known game's SWF and makes it playable.
 *
 * The GameZIP mirrors the original site's directory tree, so it carries loader
 * shims, ad stubs and unrelated SWFs beside the game -- pickGameSwf is what
 * chooses between them, and taking the first .swf instead gets you a blank
 * frame or an advert.
 *
 * The header is parsed from what was extracted rather than trusted from the
 * archive's metadata: it is what sizes the player and what predicts whether
 * Ruffle can run it at all.
 */
export async function importGameFile(slug: string): Promise<ImportResult> {
  const game = await prisma.flashGame.findUnique({ where: { slug } });
  if (!game) return { ok: false, reason: "No such game" };
  if (game.fileName) return { ok: true, slug };
  if (!game.flashpointId) {
    // A hand-added row with no file and no archive entry: there is nowhere to
    // fetch it from, and saying so is better than a generic failure.
    return { ok: false, reason: "This game has no Flashpoint entry to download from" };
  }

  const fetched = await fetchFlashpointAssetDetailed(flashpointGameZipUrl(game.flashpointId));
  if (!fetched.ok) return { ok: false, reason: fetched.reason };
  const zipBytes = fetched.bytes;

  let entries: { path: string; size: number }[];
  let zip: AdmZip;
  try {
    zip = new AdmZip(Buffer.from(zipBytes));
    entries = zip.getEntries()
      .filter((e) => !e.isDirectory)
      .map((e) => ({ path: e.entryName, size: e.header.size }));
  } catch {
    return { ok: false, reason: "The downloaded archive couldn’t be read" };
  }

  const swfPath = pickGameSwf(entries);
  if (!swfPath) return { ok: false, reason: "No Flash file inside the archive" };

  const swfBytes = zip.getEntry(swfPath)?.getData();
  if (!swfBytes?.length) return { ok: false, reason: "The Flash file was empty" };

  const meta = parseSwfMetadata(swfBytes);
  if (!meta) return { ok: false, reason: "That file isn’t a readable Flash movie" };

  const stored = await storeLocalFile(`${slug}.swf`, swfBytes);
  if (!stored) return { ok: false, reason: "Couldn’t save the file" };

  await prisma.flashGame.update({
    where: { slug },
    data: {
      fileName: stored,
      fileSize: swfBytes.length,
      storage: "local",
      width: meta.width,
      height: meta.height,
      frameRate: meta.frameRate,
      swfVersion: meta.swfVersion,
      isActionScript3: meta.isActionScript3,
    },
  });
  return { ok: true, slug };
}
