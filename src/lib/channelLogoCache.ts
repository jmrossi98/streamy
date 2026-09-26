/**
 * A local copy of each channel logo, so a dead picon host does not blank the
 * grid.
 *
 * ## Why caching is the right layer
 *
 * Every channel already has a logo recorded -- twenty-five of twenty-five
 * carry a logo_id in Dispatcharr. The pictures are what is missing: measured
 * 2026-09-26, one picon host answered HTTP 503 for everything and another did
 * not resolve, from Lightsail and mediabox alike. Jellyfin only publishes an
 * ImageTag for images it managed to fetch, so a host that was down when it
 * tried leaves the card drawing the first four characters of the name in
 * grey.
 *
 * Holding our own copy breaks that dependency: fetched once while the host
 * answers, it survives the host going away for good.
 *
 * ## What it cannot do
 *
 * Recover a logo we never held. A cache is not a source, so for the channels
 * grey right now it changes nothing until their host comes back -- which is
 * why borrowing from a sibling channel exists alongside it, and why the
 * resolution order is own image, then cache, then borrow.
 *
 * Storage mirrors flashStorage.ts: a directory of files named by a hash of
 * the upstream URL, served back through our own origin. Same reasoning as
 * there -- the bytes are replaceable, so nothing here is backed up.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STORAGE_DIR = process.env.CHANNEL_LOGO_DIR || "/app/data/channel-logos";

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Cap on a single logo. A picon is a few KB; anything approaching this is a
 * misconfigured URL pointing at something that is not an icon, and writing it
 * would be the start of filling the disk one channel at a time.
 */
const MAX_BYTES = 512 * 1024;

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * Cache key for an upstream URL.
 *
 * Hashed rather than sanitised: picon URLs carry paths, query strings and
 * occasionally characters that are not safe as filenames, and a hash is
 * fixed-length, collision-resistant and cannot escape the directory -- which
 * is the property that matters when the input comes from a provider's
 * playlist.
 */
export function logoKey(url: string): string {
  return createHash("sha256").update(url.trim()).digest("hex").slice(0, 32);
}

function pathFor(key: string): string | null {
  // Defensive: key is produced by logoKey above, but a caller could pass a
  // route parameter straight through, and hex is the only thing valid here.
  if (!/^[a-f0-9]{32}$/.test(key)) return null;
  return join(STORAGE_DIR, `${key}.img`);
}

export async function readCachedLogo(key: string): Promise<Buffer | null> {
  const path = pathFor(key);
  if (!path) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function isCached(key: string): Promise<boolean> {
  const path = pathFor(key);
  if (!path) return false;
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

/**
 * Fetches and stores one logo if it is not already held.
 *
 * Returns the key on success and null on any failure, because every failure
 * here is expected and none is worth an exception: the host may be down, the
 * URL may point at an HTML error page, the response may be enormous. The
 * caller falls back to borrowing.
 */
export async function cacheLogo(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;

  const key = logoKey(trimmed);
  if (await isCached(key)) return key;

  try {
    const res = await fetch(trimmed, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    // A 503 page served as text/html is still a 200 from some hosts, and
    // storing it would cache a broken image permanently.
    if (!ALLOWED_TYPES.has(type)) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;

    const path = pathFor(key);
    if (!path) return null;
    await mkdir(STORAGE_DIR, { recursive: true });
    await writeFile(path, buf);
    return key;
  } catch {
    return null;
  }
}

/** Public URL for a cached logo, served by our own origin. */
export function cachedLogoUrl(key: string): string {
  return `/api/livetv/logo/${key}`;
}

/**
 * Media type from the bytes themselves.
 *
 * The cache accepts four formats but stores them under one extension, and the
 * serving route must not guess: labelling a JPEG as image/png renders nothing
 * in some browsers and is exactly the sort of thing that looks like a missing
 * logo. Magic numbers rather than a sidecar file, so a half-written pair can
 * never disagree.
 */
export function sniffImageType(buf: Buffer): string {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii").startsWith("GIF8")) {
    return "image/gif";
  }
  // Only reachable if the allowlist and this drift apart; png is the safest
  // wrong answer because it is what most picons are.
  return "image/png";
}

