/**
 * Where a Flash game's SWF actually lives.
 *
 * Two sources, checked in order:
 *
 *   local     Streamy's own data volume. Everything imported from Flashpoint,
 *             and anything uploaded through the admin form, lands here.
 *   mediabox  The read-only share over Tailscale. Whatever was copied into
 *             /data/flash by hand.
 *
 * Local is preferred deliberately. The size argument that puts ROMs and films
 * on mediabox does not apply to Flash: a SWF is single-digit megabytes, so a
 * hundred games is about half a gigabyte, against 51GB free on Lightsail and
 * mediabox's /data sitting at 93%. Storing locally also means Flash games keep
 * working when mediabox is asleep -- which it has been repeatedly -- and drops
 * a tailnet round trip from every load.
 *
 * The tradeoff, stated plainly: this volume is not backed up (Litestream
 * covers the SQLite file, not arbitrary files). It is treated as a cache --
 * anything from Flashpoint can be re-imported, and saves, which are the
 * irreplaceable part, live in the database.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isSafeFlashFileName } from "./flashLibrary";

const STORAGE_DIR = process.env.FLASH_STORAGE_DIR || "/app/data/flash";

export type StorageKind = "local" | "mediabox";

/** Absolute path for a name that has already passed the safe-name check. */
function pathFor(fileName: string): string | null {
  if (!isSafeFlashFileName(fileName)) return null;
  return join(STORAGE_DIR, fileName);
}

export async function localFileExists(fileName: string): Promise<boolean> {
  const path = pathFor(fileName);
  if (!path) return false;
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function readLocalFile(fileName: string): Promise<Buffer | null> {
  const path = pathFor(fileName);
  if (!path) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

/**
 * Writes a SWF into local storage under a name nothing else is using.
 *
 * Returns the name actually used, which may differ from the one asked for:
 * two games can reasonably want "game.swf", and silently overwriting one with
 * the other would replace a working game with a different one.
 */
export async function storeLocalFile(
  preferredName: string,
  bytes: Buffer
): Promise<string | null> {
  await mkdir(STORAGE_DIR, { recursive: true });

  const base = preferredName.replace(/\.swf$/i, "");
  let name = `${base}.swf`;
  for (let n = 2; await localFileExists(name); n++) {
    name = `${base}-${n}.swf`;
  }

  const path = pathFor(name);
  if (!path) return null;
  try {
    await writeFile(path, bytes);
    return name;
  } catch {
    return null;
  }
}
