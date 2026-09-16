/**
 * Andkon Arcade as a second source for game files.
 *
 * Flashpoint is the better source when it has a game: it carries real
 * metadata -- developer, description, tags, box art -- and a GameZIP that
 * often holds several mirrors to choose between. But it simply does not have
 * everything. Of Andkon's 4,686 games, only about half resolve to a
 * Flashpoint entry with a downloadable GameZIP; the rest return no search hit
 * at all. "The Game Game" and its three sequels are the case that surfaced
 * this -- present on Andkon, absent from Flashpoint, and so unfindable and
 * undownloadable here no matter what anyone typed.
 *
 * Andkon serves its SWFs directly from the game's own page, so those games are
 * reachable after all. Metadata is thinner (a title, and whatever the SWF
 * header says once it is parsed), which is the honest trade for having the
 * game at all.
 *
 * Fetched once per game and then served locally, same as Flashpoint -- this
 * is someone else's bandwidth, and putting it in the path of every play would
 * be both rude and fragile.
 */

const ANDKON_BASE = "https://www.andkon.com/arcade";

/** A game page is a few KB of HTML; the SWF behind it can be several MB. */
const PAGE_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** "category/slug", the shape stored on FlashGame.andkonPath. */
export function isAndkonPath(path: string): boolean {
  return /^[a-z0-9]+\/[a-z0-9._-]+$/.test(path);
}

export function andkonGameUrl(path: string): string {
  return `${ANDKON_BASE}/${path}/`;
}

/**
 * Andkon's own icon for a game, used as card art.
 *
 * Keyed on the slug rather than the full path -- the icons live in one flat
 * directory. Not every game has one.
 */
export function andkonIconUrl(path: string): string | null {
  const slug = path.split("/")[1];
  return slug ? `${ANDKON_BASE}/ICONS/${slug}.gif` : null;
}

/**
 * Finds the SWF a game page embeds.
 *
 * Parsed from the page rather than assumed to be `<slug>.swf`. That pattern
 * holds for every page checked, but it is a convention rather than a rule,
 * and a wrong guess here is a download that 404s for no visible reason. The
 * page is small and this runs once per game, so reading it is cheap.
 *
 * Both tag forms are tried: these pages carry the old `<object><param
 * name="movie">` alongside `<embed src>`, and which one appears first varies.
 */
export async function findAndkonSwfUrl(path: string): Promise<string | null> {
  if (!isAndkonPath(path)) return null;
  const pageUrl = andkonGameUrl(path);
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/<embed[^>]*\ssrc="([^"]+\.swf)"/i) ||
      html.match(/<param[^>]*\sname="movie"[^>]*\svalue="([^"]+\.swf)"/i);
    if (!match) return null;
    const resolved = new URL(match[1], pageUrl);
    // Only ever fetch from Andkon itself: the page is third-party HTML, and a
    // relative-looking src could resolve anywhere.
    if (resolved.hostname !== "www.andkon.com" && resolved.hostname !== "andkon.com") {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}

export type AndkonFetch =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; reason: string };

/** Downloads a game's SWF from Andkon. */
export async function fetchAndkonSwf(path: string): Promise<AndkonFetch> {
  const url = await findAndkonSwfUrl(path);
  if (!url) return { ok: false, reason: "Couldn’t find this game’s file on Andkon" };
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `Andkon returned ${res.status}` };
    return { ok: true, bytes: await res.arrayBuffer() };
  } catch {
    return { ok: false, reason: "Couldn’t reach Andkon" };
  }
}
