/**
 * Flashpoint Archive client -- the catalogue behind Streamy's Flash games.
 *
 * Ruffle plays a SWF but knows nothing about it: no titles, artwork,
 * descriptions, genres or search. That has to come from somewhere else, and
 * Flashpoint Archive is the preservation project that has it -- 180,000+
 * arcade entries with tags, developers, descriptions, logos and screenshots,
 * behind a public API.
 *
 * Metadata is read live from here; anything actually added to the library is
 * copied to mediabox once and served locally afterwards. Proxying their files
 * on every play would put a volunteer project's bandwidth in the path of
 * someone pressing Play, which is both rude and fragile.
 *
 * Nothing here is required for Streamy to work. A game can be added with its
 * own SWF and hand-entered details, so an unreachable Flashpoint costs search
 * and nothing else.
 */

const FLASHPOINT_API = process.env.FLASHPOINT_API_URL?.replace(/\/$/, "")
  || "https://db-api.unstable.life";

/** Someone else's volunteer-run service on the far side of the internet. */
const SEARCH_TIMEOUT_MS = 15_000;
/** A GameZIP is multiple megabytes; this one is a download, not a lookup. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

export type FlashpointGame = {
  id: string;
  title: string;
  /** Free text, often empty. Used for display only, never matching. */
  developer: string;
  publisher: string;
  /** Genre-ish labels. The source of the tab's row grouping. */
  tags: string[];
  /** "Flash", "HTML5", "Shockwave", ... -- only Flash is playable here. */
  platform: string;
  /**
   * Flashpoint's own assessment: "Playable", "Partial", "Hacked", "Not
   * Playable". Describes REAL Flash Player, not Ruffle -- a game can be
   * "Playable" here and still fail in Ruffle. parseSwfMetadata's
   * isActionScript3 is the better Ruffle predictor.
   */
  status: string;
  releaseDate: string;
  language: string;
  description: string;
};

type RawGame = {
  id?: string;
  title?: string;
  developer?: string;
  publisher?: string;
  tags?: unknown;
  platform?: string;
  status?: string;
  releaseDate?: string;
  language?: string;
  originalDescription?: string;
};

export function isFlashpointConfigured(): boolean {
  return !!FLASHPOINT_API;
}

/**
 * Normalises one search hit.
 *
 * Every field is optional in practice -- plenty of entries have no developer,
 * no release date and an empty description -- so this fills rather than
 * rejects. Only a missing id or title makes a row useless.
 */
export function toFlashpointGame(raw: RawGame): FlashpointGame | null {
  if (!raw?.id || !raw?.title) return null;
  return {
    id: raw.id,
    title: raw.title,
    developer: raw.developer || "",
    publisher: raw.publisher || "",
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    platform: raw.platform || "",
    status: raw.status || "",
    releaseDate: raw.releaseDate || "",
    language: raw.language || "",
    description: raw.originalDescription || "",
  };
}

/**
 * Genre rows to offer when browsing the archive.
 *
 * Hardcoded rather than read from /tags, deliberately. That endpoint returns
 * every tag in the database -- hundreds, including franchise names, engines
 * ("Stencyl") and bookkeeping -- and a row per tag would be unusable. These
 * are the genre-category tags broad enough that a row of them is worth
 * scrolling.
 */
export const BROWSE_GENRES = [
  "Action",
  "Adventure",
  "Arcade",
  "Platformer",
  "Puzzle",
  "Shooter",
  "Sports",
  "Strategy",
  "Simulation",
  "Racing",
] as const;

/**
 * Games in one genre, straight from the archive.
 *
 * The filtering parameter is `tags`, which is a real searchable field. Two
 * near-misses worth recording, since both fail by returning an empty array
 * rather than an error: `tag` is not a field at all, and `tagsStr` is a
 * *post*-filter applied to results, so on its own it matches nothing because
 * no query ran to produce results in the first place.
 *
 * `filter=true` drops entries the archive flags as unsuitable; `platform=Flash`
 * keeps out the Shockwave, Unity and HTML5 content Ruffle cannot play.
 */
export async function browseFlashpointGenre(
  genre: string,
  limit = 24
): Promise<FlashpointGame[]> {
  const params = new URLSearchParams({
    tags: genre,
    platform: "Flash",
    filter: "true",
    limit: String(limit),
  });
  try {
    const res = await fetch(`${FLASHPOINT_API}/search?${params.toString()}`, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      // Genre rows are the same for everyone and the archive changes rarely,
      // so this is the one call here worth caching -- it turns a page load
      // from ten upstream requests into none.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const raw = (await res.json()) as RawGame[];
    if (!Array.isArray(raw)) return [];
    return raw
      .map(toFlashpointGame)
      .filter((g): g is FlashpointGame => g !== null)
      .filter(isPlayableHere);
  } catch {
    return [];
  }
}

/** Only Flash entries can be played here -- Shockwave, Unity and HTML5 can't. */
export function isPlayableHere(game: FlashpointGame): boolean {
  return game.platform.toLowerCase() === "flash";
}

/**
 * Searches the archive by title.
 *
 * `title=` and `smartSearch=` both work against this API; `q=` silently
 * returns an empty array, which is the kind of thing worth writing down
 * because it looks identical to "no results".
 *
 * Returns [] rather than throwing: search is an enhancement here, and an
 * unreachable archive should degrade to "nothing found", never to a broken
 * page.
 */
export async function searchFlashpoint(query: string, limit = 30): Promise<FlashpointGame[]> {
  const q = query.trim();
  if (!q) return [];

  const params = new URLSearchParams({ title: q, limit: String(limit) });
  try {
    const res = await fetch(`${FLASHPOINT_API}/search?${params.toString()}`, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const raw = (await res.json()) as RawGame[];
    if (!Array.isArray(raw)) return [];
    return raw
      .map(toFlashpointGame)
      .filter((g): g is FlashpointGame => g !== null);
  } catch {
    return [];
  }
}

/** Box art for an entry. Fetched once at import, then served from mediabox. */
export function flashpointLogoUrl(id: string): string {
  return `${FLASHPOINT_API}/logo?id=${encodeURIComponent(id)}`;
}

export function flashpointScreenshotUrl(id: string): string {
  return `${FLASHPOINT_API}/screenshot?id=${encodeURIComponent(id)}`;
}

/**
 * The GameZIP holding the entry's actual files.
 *
 * Called exactly once per game, at import. Never on a play -- see the note at
 * the top of this file.
 */
export function flashpointGameZipUrl(id: string): string {
  return `${FLASHPOINT_API}/get?id=${encodeURIComponent(id)}`;
}

/** Downloads one archive asset, or null if it isn't available. */
export async function fetchFlashpointAsset(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}


/**
 * Finds the SWF inside a Flashpoint GameZIP.
 *
 * Pure, so it tests without downloading anything.
 *
 * A GameZIP mirrors the original site's directory structure, so it routinely
 * carries loader shims, preloaders, ad stubs and several unrelated SWFs
 * alongside the game. Picking the wrong one gets you a blank frame or an
 * advert, so the choice is deliberate rather than "the first .swf":
 *
 *   - `content/` holds the preserved site; anything outside it is packaging
 *   - obvious non-games are rejected by name
 *   - the largest survivor wins, since a loader or ad stub is tiny next to the
 *     game it loads
 */
const NON_GAME_SWF = /(loader|preloader|ads?|advert|logo|intro|splash|banner)\.swf$/i;

export function pickGameSwf(
  entries: { path: string; size: number }[]
): string | null {
  const swfs = entries.filter((e) => e.path.toLowerCase().endsWith(".swf"));
  if (swfs.length === 0) return null;

  const inContent = swfs.filter((e) => e.path.toLowerCase().includes("content/"));
  const candidates = (inContent.length > 0 ? inContent : swfs).filter(
    (e) => !NON_GAME_SWF.test(e.path)
  );

  // Everything looked like packaging -- better to take the biggest of what
  // there is than to give up on a game that is present.
  const pool = candidates.length > 0 ? candidates : swfs;
  return pool.reduce((best, e) => (e.size > best.size ? e : best)).path;
}
