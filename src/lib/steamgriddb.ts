/**
 * SteamGridDB API client (server-side only). Set SGDB_API_KEY in env to
 * enable; a free key from steamgriddb.com.
 *
 * This is the *picker* half of ROM artwork. The Steam Deck's own
 * steam_sync.py (see mediabox-infra/deck/) already auto-fetches art for any
 * game that has none, choosing the top-scoring match itself -- which is right
 * for unattended imports but has no way to be told "not that one, this one".
 * Everything here exists so a person can look at the real candidates and
 * choose; the chosen URL is stored as an override that steam_sync.py prefers
 * over its own automatic pick (see /api/games/artwork-overrides).
 *
 * The key never reaches the browser: the client component calls Streamy's own
 * admin routes, which call this. Same reason radarr.ts's key stays server-side.
 */

const SGDB_API = "https://www.steamgriddb.com/api/v2";
const SGDB_API_KEY = process.env.SGDB_API_KEY;

export function isSgdbConfigured(): boolean {
  return !!SGDB_API_KEY;
}

const SGDB_TIMEOUT_MS = 15_000;

async function sgdbFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SGDB_API}${path}`, {
    headers: { Authorization: `Bearer ${SGDB_API_KEY!}` },
    signal: AbortSignal.timeout(SGDB_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SteamGridDB error: ${res.status} ${body}`.trim());
  }
  return (await res.json()) as T;
}

/** The four asset kinds Steam renders for a non-Steam shortcut. */
export type ArtworkKind = "grid" | "hero" | "logo" | "icon";

export const ARTWORK_KINDS: ArtworkKind[] = ["grid", "hero", "logo", "icon"];

export function isArtworkKind(v: unknown): v is ArtworkKind {
  return typeof v === "string" && (ARTWORK_KINDS as string[]).includes(v);
}

/**
 * Human labels that say where the asset actually shows up, rather than
 * SteamGridDB's own internal names -- "grid" and "hero" mean nothing to
 * someone looking at a Steam library, and this picker is the one place a
 * person has to reason about all four at once.
 */
export const ARTWORK_LABELS: Record<ArtworkKind, string> = {
  grid: "Cover (portrait)",
  hero: "Banner (wide)",
  logo: "Logo",
  icon: "Icon",
};

// SteamGridDB's own endpoint + dimension filter per kind. The 600x900 grid
// filter matters: Steam's library uses the portrait shape, and an unfiltered
// /grids call returns mostly legacy wide 460x215 art that Steam will accept
// and then render letterboxed into a portrait slot.
const KIND_ENDPOINTS: Record<ArtworkKind, (gameId: number) => string> = {
  grid: (id) => `/grids/game/${id}?dimensions=600x900`,
  hero: (id) => `/heroes/game/${id}`,
  logo: (id) => `/logos/game/${id}`,
  icon: (id) => `/icons/game/${id}`,
};

export type SgdbGame = { id: number; name: string };

/** Title search, for resolving which SteamGridDB game a ROM refers to. */
export async function searchSgdbGames(term: string): Promise<SgdbGame[]> {
  if (!isSgdbConfigured()) return [];
  try {
    const data = await sgdbFetch<{ data?: { id: number; name: string }[] }>(
      `/search/autocomplete/${encodeURIComponent(term)}`
    );
    return (data.data ?? []).map((g) => ({ id: g.id, name: g.name }));
  } catch (err) {
    console.error(`[sgdb] searchSgdbGames failed for "${term}":`, err);
    return [];
  }
}

export type ArtworkCandidate = {
  id: number;
  /** Full-size asset -- what actually gets applied. */
  url: string;
  /** Smaller version, used for the picker grid so choosing art doesn't pull
   *  dozens of full-size PNGs. */
  thumb: string;
  width: number | null;
  height: number | null;
  /** Community score, for ordering. */
  score: number | null;
};

/**
 * Artwork candidates of one kind for a SteamGridDB game id.
 *
 * NSFW and "humor" entries are filtered out rather than shown and flagged:
 * this is a library-cover picker, and SteamGridDB's own flags are reliable
 * enough to just not surface those.
 */
export async function getArtworkCandidates(
  gameId: number,
  kind: ArtworkKind
): Promise<ArtworkCandidate[]> {
  if (!isSgdbConfigured()) return [];
  try {
    const data = await sgdbFetch<{
      data?: {
        id: number;
        url?: string;
        thumb?: string;
        width?: number;
        height?: number;
        score?: number;
        nsfw?: boolean;
        humor?: boolean;
      }[];
    }>(KIND_ENDPOINTS[kind](gameId));
    return (data.data ?? [])
      .filter((a) => !a.nsfw && !a.humor && a.url)
      .map((a) => ({
        id: a.id,
        url: a.url!,
        thumb: a.thumb || a.url!,
        width: a.width ?? null,
        height: a.height ?? null,
        score: a.score ?? null,
      }));
  } catch (err) {
    console.error(`[sgdb] getArtworkCandidates failed for ${gameId}/${kind}:`, err);
    return [];
  }
}
