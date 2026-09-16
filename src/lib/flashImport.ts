/**
 * Bringing a Flashpoint entry into the local library.
 *
 * Two steps that are easy to conflate: a game becomes *known* (a catalogue row
 * with its metadata) the moment someone shows interest in it, and it becomes
 * *playable* only once its SWF has been fetched. Bookmarking something should
 * not download it, so those happen separately.
 */

import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { prisma } from "./db";
import {
  fetchFlashpointAssetDetailed,
  flashpointGameZipUrl,
  pickGameSwfDetailed,
  type FlashpointGame,
} from "./flashpoint";
import { fetchAndkonSwf } from "./andkon";
import { findCatalogAndkonPath } from "./flashCatalog";
import { slugFromFileName } from "./flashGameRules";
import { deleteLocalFile, storeLocalFile } from "./flashStorage";
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
export async function ensureKnownGame(
  game: FlashpointGame,
  /**
   * Andkon's path for the same game, when the catalogue knows one. Stored
   * alongside the Flashpoint id so the importer has somewhere to fall back to
   * if every build in the GameZIP turns out to be domain-locked.
   */
  andkonPath: string | null = null
): Promise<string> {
  const existing = await prisma.flashGame.findUnique({
    where: { flashpointId: game.id },
    select: { slug: true, andkonPath: true },
  });
  if (existing) {
    // Backfill: rows created before the catalogue carried Andkon paths, or by
    // a plain search result, have none.
    if (andkonPath && !existing.andkonPath) {
      await prisma.flashGame
        .update({ where: { slug: existing.slug }, data: { andkonPath } })
        // A unique clash means another row already claims this path; the id
        // match above is the stronger identity, so keep it and move on.
        .catch(() => undefined);
    }
    return existing.slug;
  }

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
      andkonPath,
    },
  });
  return slug;
}

/**
 * Records an Andkon-only game locally and returns its slug.
 *
 * The counterpart to ensureKnownGame for the roughly half of Andkon's
 * catalogue that Flashpoint has no entry for. There is no metadata to copy --
 * no developer, description or tags -- so the row carries the title and the
 * path its file will come from, and the SWF header fills in the dimensions at
 * import.
 *
 * Idempotent on the Andkon path, for the same reason the Flashpoint version is
 * idempotent on its id.
 */
export async function ensureKnownAndkonGame(
  andkonPath: string,
  title: string
): Promise<string> {
  const existing = await prisma.flashGame.findUnique({
    where: { andkonPath },
    select: { slug: true },
  });
  if (existing) return existing.slug;

  let slug = slugFromTitle(title);
  for (let n = 2; await prisma.flashGame.findUnique({ where: { slug } }); n++) {
    slug = `${slugFromTitle(title)}-${n}`;
  }

  await prisma.flashGame.create({ data: { slug, title, andkonPath } });
  return slug;
}

export type ImportResult =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/**
 * Throws away a game's downloaded file, keeping the catalogue row.
 *
 * The row is what someone's My List entry and their saves point at, so
 * deleting it would take those with it. Clearing the file instead leaves the
 * game exactly where it was, just undownloaded -- opening it fetches a fresh
 * copy.
 *
 * This is the repair for a game that downloaded badly: a domain-locked build
 * when an unlocked mirror existed, a regional rip in the wrong language, a
 * loader stub picked instead of the game. All of those have happened, and
 * until now the only fix was an admin editing the database by hand.
 */
export async function deleteGameFile(slug: string): Promise<ImportResult> {
  const game = await prisma.flashGame.findUnique({ where: { slug } });
  if (!game) return { ok: false, reason: "No such game" };
  if (!game.fileName) return { ok: true, slug };

  // mediabox's share is mounted read-only -- that copy is not ours to delete,
  // so the row is simply detached from it.
  if (game.storage === "local" && !(await deleteLocalFile(game.fileName))) {
    return { ok: false, reason: "Couldn’t delete the file" };
  }

  await prisma.flashGame.update({
    where: { slug },
    data: { fileName: null, fileSize: 0, storage: null },
  });
  return { ok: true, slug };
}

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

  // Rows added from a plain Flashpoint search carry no Andkon path, so when
  // their GameZIP 404s there is nothing to fall back to. Both of the games
  // reported as undownloadable -- Synapsis and Epic Battle Fantasy -- were in
  // that state while Andkon had them all along. Looking it up here means an
  // existing row repairs itself the first time someone tries again, rather
  // than needing a migration.
  const andkonPath =
    game.andkonPath ?? findCatalogAndkonPath(game.flashpointId, game.title);
  if (andkonPath && andkonPath !== game.andkonPath) {
    await prisma.flashGame
      .update({ where: { slug }, data: { andkonPath } })
      // Another row already claims this path -- fine, this one just uses it
      // for the download without recording it.
      .catch(() => undefined);
  }

  // Flashpoint first when the game is there -- its GameZIP usually holds
  // several mirrors, and picking between them is what avoids domain-locked
  // and regionally-rewritten builds. Andkon is a single copy, so it is the
  // fallback rather than the default, but for roughly half of its catalogue
  // it is the only source there is.
  const source = await loadSwf({ ...game, andkonPath });
  if (!source.ok) return { ok: false, reason: source.reason };
  const swfBytes = source.bytes;

  const meta = parseSwfMetadata(swfBytes);
  if (!meta) return { ok: false, reason: "That file isn’t a readable Flash movie" };

  // Content-hashed, not just `${slug}.swf`. /api/flash/[fileName] serves these
  // with `Cache-Control: immutable`, which is only true if the bytes behind a
  // URL never change -- and re-importing a game is exactly the case where they
  // do. Overwriting in place poisoned every browser that had already cached
  // the old copy: Learn to Fly kept serving a Vietnamese rip, and Duck Life 4
  // kept serving Armor Games' domain-locked build, long after the server had
  // the right file. A new build gets a new name, so the cache is never wrong;
  // identical bytes resolve to the same name and cost nothing.
  const digest = createHash("sha256").update(swfBytes).digest("hex").slice(0, 8);
  const stored = await storeLocalFile(`${slug}-${digest}.swf`, swfBytes);
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

type SwfSource = { ok: true; bytes: Buffer } | { ok: false; reason: string };

/**
 * Gets the game's SWF bytes from whichever source the row points at.
 *
 * A row can have a Flashpoint id, an Andkon path, or both. Flashpoint is
 * tried first where present -- see the note at the call site -- and Andkon
 * catches both the "no Flashpoint entry at all" case and the surprisingly
 * common "entry exists, GameZIP 404s" one.
 */
async function loadSwf(game: {
  flashpointId: string | null;
  andkonPath: string | null;
}): Promise<SwfSource> {
  let flashpointReason: string | null = null;

  // Kept aside rather than returned immediately: when the only build
  // Flashpoint has is a domain-locked one, Andkon's copy is worth trying
  // first, and this is the fallback if Andkon hasn't got the game either.
  let lockedFallback: Buffer | null = null;

  if (game.flashpointId) {
    const fetched = await fetchFlashpointAssetDetailed(flashpointGameZipUrl(game.flashpointId));
    if (fetched.ok) {
      try {
        const zip = new AdmZip(Buffer.from(fetched.bytes));
        const entries = zip
          .getEntries()
          .filter((e) => !e.isDirectory)
          .map((e) => ({ path: e.entryName, size: e.header.size }));
        const picked = pickGameSwfDetailed(entries);
        const bytes = picked ? zip.getEntry(picked.path)?.getData() : null;
        if (bytes?.length) {
          // A copy that will actually run: done.
          if (!picked!.compromised) return { ok: true, bytes };
          // Otherwise every candidate was locked to its original domain or was
          // a cheat rip. Andkon re-hosts games on its own site, so whatever it
          // serves demonstrably runs somewhere that isn't the publisher --
          // which is exactly the property missing here. Duck Life 4 is the
          // case that motivated this: Flashpoint's copies are Armor Games'
          // locked build and one mirror, and when the mirror is absent the
          // locked one is all that's left.
          lockedFallback = bytes;
        } else {
          flashpointReason = "No Flash file inside the archive";
        }
      } catch {
        flashpointReason = "The downloaded archive couldn’t be read";
      }
    } else {
      flashpointReason = fetched.reason;
    }
  }

  if (game.andkonPath) {
    const fetched = await fetchAndkonSwf(game.andkonPath);
    if (fetched.ok) return { ok: true, bytes: Buffer.from(fetched.bytes) };
    // Andkon hasn't got it either. A locked build still beats no game at all,
    // and it is at least honest about why it won't play.
    if (lockedFallback) return { ok: true, bytes: lockedFallback };
    // Both sources failed. Report Flashpoint's reason when there was one --
    // it is the more specific of the two.
    return { ok: false, reason: flashpointReason ?? fetched.reason };
  }

  if (lockedFallback) return { ok: true, bytes: lockedFallback };
  if (flashpointReason) return { ok: false, reason: flashpointReason };
  // A hand-added row with no file and no source: there is nowhere to fetch it
  // from, and saying so is better than a generic failure.
  return { ok: false, reason: "This game has no download source" };
}
