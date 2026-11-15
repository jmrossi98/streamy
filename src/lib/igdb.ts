/**
 * IGDB, the game catalog: what Movies and TV get from TMDB, for games --
 * names, covers, summaries, and which consoles a game came out on.
 * Server-only.
 *
 * IGDB authenticates through a Twitch developer app (client credentials):
 * IGDB_CLIENT_ID and IGDB_CLIENT_SECRET. The app token lasts about two
 * months and is renewed on its own a day before it lapses, or at once when
 * IGDB refuses it. Unset, the catalog is simply absent.
 */
import { sharedRead } from "./sharedRead";
import { SUPPORTED_IGDB_PLATFORMS, systemsForIgdbPlatforms } from "./gameSystems";

const CLIENT_ID = process.env.IGDB_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET ?? "";
const TIMEOUT_MS = 15_000;
const SEARCH_TTL_MS = 10 * 60_000;
const GAME_TTL_MS = 60 * 60_000;

export function isIgdbConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(fresh = false): Promise<string> {
  if (!fresh && token && Date.now() < token.expiresAt) return token.value;
  const qs = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials" });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${qs}`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`IGDB login failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in - 86_400) * 1000 };
  return token.value;
}

async function igdb<T>(endpoint: string, query: string): Promise<T> {
  if (!isIgdbConfigured()) throw new Error("IGDB is not configured");
  const call = async (bearer: string) =>
    fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: "POST",
      headers: { "Client-ID": CLIENT_ID, Authorization: `Bearer ${bearer}`, Accept: "application/json" },
      body: query,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  let res = await call(await accessToken());
  if (res.status === 401) res = await call(await accessToken(true));
  if (!res.ok) throw new Error(`IGDB ${endpoint} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

type RawGame = {
  id: number;
  name: string;
  first_release_date?: number;
  summary?: string;
  storyline?: string;
  cover?: { image_id?: string };
  artworks?: { image_id?: string }[];
  screenshots?: { image_id?: string }[];
  platforms?: number[];
  genres?: { name?: string }[];
  involved_companies?: { developer?: boolean; publisher?: boolean; company?: { name?: string } }[];
  total_rating?: number;
};

export type CatalogGame = {
  id: number;
  name: string;
  year: number | null;
  summary: string | null;
  coverUrl: string | null;
  backdropUrl: string | null;
  /** The consoles it came out on that Streamy can fetch for (gameSystems.ts slugs). */
  systems: string[];
  genres: string[];
  developer: string | null;
  /** 0-100, IGDB's combined critic and user rating. */
  rating: number | null;
};

/** An IGDB image at one of its named sizes ("cover_big", "1080p"...). */
export function igdbImage(imageId: string | null | undefined, size: string): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : null;
}

function toCatalogGame(g: RawGame): CatalogGame {
  const backdrop = g.artworks?.find((a) => a.image_id)?.image_id ?? g.screenshots?.find((s) => s.image_id)?.image_id;
  return {
    id: g.id,
    name: g.name,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    summary: g.summary ?? g.storyline ?? null,
    coverUrl: igdbImage(g.cover?.image_id, "cover_big"),
    backdropUrl: igdbImage(backdrop, "1080p"),
    systems: systemsForIgdbPlatforms(g.platforms ?? []).map((s) => s.slug),
    genres: (g.genres ?? []).map((x) => x.name).filter((x): x is string => !!x),
    developer: g.involved_companies?.find((c) => c.developer)?.company?.name ?? null,
    rating: g.total_rating != null ? Math.round(g.total_rating) : null,
  };
}

const LIST_FIELDS = "name,first_release_date,summary,cover.image_id,platforms,genres.name,total_rating";

/** An Apicalypse string literal. */
function quoted(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Games matching the text that came out on a console Streamy can fetch for.
 * Editions of another game (version_parent) are left out: the original is
 * what the release names follow.
 */
export async function searchCatalog(text: string): Promise<CatalogGame[]> {
  const q = text.trim().slice(0, 100);
  if (!q) return [];
  return sharedRead(`igdb:search:${q.toLowerCase()}`, SEARCH_TTL_MS, async () => {
    const rows = await igdb<RawGame[]>(
      "games",
      `search ${quoted(q)}; fields ${LIST_FIELDS}; where platforms = (${SUPPORTED_IGDB_PLATFORMS.join(",")}) & version_parent = null; limit 40;`
    );
    return rows.map(toCatalogGame).filter((g) => g.systems.length > 0);
  });
}

/** One game with everything its page shows; null when IGDB has no such game. */
export async function getCatalogGame(id: number): Promise<CatalogGame | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return sharedRead(`igdb:game:${id}`, GAME_TTL_MS, async () => {
    const rows = await igdb<RawGame[]>(
      "games",
      `fields ${LIST_FIELDS},storyline,artworks.image_id,screenshots.image_id,involved_companies.developer,involved_companies.company.name; where id = ${id}; limit 1;`
    );
    return rows[0] ? toCatalogGame(rows[0]) : null;
  });
}
