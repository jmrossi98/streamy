/**
 * The SWF files themselves, served by the `flash` container on mediabox.
 *
 * Split from flashpoint.ts on purpose: that file is the *catalogue* (what a
 * game is called, who made it, what it looks like), this one is the *payload*
 * (the bytes Ruffle loads). A game can exist here with no Flashpoint entry at
 * all -- someone drops a SWF into /data/flash and it appears -- and a
 * Flashpoint entry means nothing until its file has been copied across.
 *
 * Proxied rather than linked, for the same reasons Jellyfin playback is: the
 * library is a Tailscale-only plain-HTTP address, so a viewer's browser can't
 * route to it and an HTTPS page couldn't load from it anyway.
 */

const FLASH_LIBRARY_URL = process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "");

/** Listing is on a page-load path; a sleeping mediabox must not hang it. */
const LIST_TIMEOUT_MS = 8_000;
/** A SWF is multiple megabytes over the tailnet. */
const FETCH_TIMEOUT_MS = 60_000;

export type FlashFile = {
  name: string;
  size: number;
  /** Last modified, as nginx reports it. Free text; display only. */
  mtime: string;
};

type RawEntry = { name?: unknown; type?: unknown; size?: unknown; mtime?: unknown };

export function isFlashLibraryConfigured(): boolean {
  return !!FLASH_LIBRARY_URL;
}

/**
 * Keeps a filename inside the library directory.
 *
 * The name reaches this from a database row, but the row can be written from a
 * Flashpoint title, so it is not automatically safe. A traversal here would
 * turn the proxy into a reader of anything nginx can see, so the check is a
 * whitelist of what a legitimate SWF filename looks like rather than a
 * blacklist of what an attack looks like.
 */
export function isSafeFlashFileName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (name.startsWith(".")) return false;
  return /^[A-Za-z0-9._ ()\[\]'-]+\.swf$/i.test(name);
}

/**
 * Everything currently sitting in /data/flash.
 *
 * Parses nginx's JSON autoindex -- which is why the server is configured to
 * emit JSON rather than its default HTML. This is how a SWF copied in by hand
 * gets noticed, so it stays useful even with Flashpoint unreachable.
 *
 * Returns [] rather than throwing: an unreachable mediabox means "no files
 * visible right now", which the page can say, not a crash.
 */
export async function listFlashFiles(): Promise<FlashFile[]> {
  if (!FLASH_LIBRARY_URL) return [];
  try {
    const res = await fetch(`${FLASH_LIBRARY_URL}/`, {
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const raw = (await res.json()) as RawEntry[];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (e): e is RawEntry & { name: string } =>
          e?.type === "file" && typeof e.name === "string" && isSafeFlashFileName(e.name)
      )
      .map((e) => ({
        name: e.name,
        size: typeof e.size === "number" ? e.size : 0,
        mtime: typeof e.mtime === "string" ? e.mtime : "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Upstream URL for one file. Only ever reached through the proxy route. */
export function flashFileUpstreamUrl(fileName: string): string | null {
  if (!FLASH_LIBRARY_URL || !isSafeFlashFileName(fileName)) return null;
  return `${FLASH_LIBRARY_URL}/${encodeURIComponent(fileName)}`;
}

/**
 * Fetches one SWF, for the import step that reads its header.
 *
 * Deliberately separate from the playback proxy, which streams bytes straight
 * through without ever holding a whole file -- this one buffers, because
 * parsing a header needs the front of the file in memory anyway.
 */
export async function fetchFlashFile(fileName: string): Promise<Buffer | null> {
  const url = flashFileUpstreamUrl(fileName);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
