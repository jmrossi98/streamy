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
