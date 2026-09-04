/**
 * Merges gamarr's three separate surfaces -- wishlist, active/recent
 * downloads, and the scanned ROM library -- into one list keyed by gameKey
 * (see romNames.ts). None of the three share a common id, so a game is
 * matched across them by normalized title; same pattern the admin page
 * already uses to merge Radarr's active+completed+still-searching movies
 * into one `downloads` list.
 */

import { prisma } from "./db";
import { getGameLibrary, getGameDownloads, getWishlist } from "./gamarr";
import { gameKeyOf, romSearchTitle, titleSimilarity } from "./romNames";
import { cleanLibrary } from "./gameLibraryCleanup";

export type GameStatus = "library" | "downloading" | "failed" | "queued";

export type GameListItem = {
  gameKey: string;
  /** Raw title as gamarr reports it -- a ROM filename for a library item
   *  ("Final Fantasy VIII (USA) (Disc 4)", sometimes literally a filename
   *  like "tomb_raider"), or a release name for a wishlist/download entry.
   *  Kept around because it's what search/matching logic actually needs;
   *  never shown to a user directly -- see displayTitle for that. */
  title: string;
  /** What to actually show someone: title with region/version/release-tag
   *  noise stripped (romSearchTitle). Still imperfect for a raw filename
   *  with no formatting at all ("tomb_raider" stays "tomb_raider"), but
   *  strictly better than showing the noise verbatim. */
  displayTitle: string;
  platform: string;
  platformSlug: string;
  status: GameStatus;
  /** 0-100, only meaningful while status is "downloading". */
  progress: number | null;
  /** Set only once a real file exists (status "library") -- everything an
   *  artwork override or a Deck symlink needs to find it. */
  system: string | null;
  romStem: string | null;
  sizeBytes: number | null;
  /** Chosen cover art, when one has been picked (see GameArtwork). Only
   *  possible once system/romStem are known. */
  posterUrl: string | null;
  /** For removing a not-yet-downloading wishlist entry. */
  wishlistId: number | null;
  /** For retrying a failed job. */
  jobId: string | null;
  /** gamarr's own error text for a failed job. */
  error: string | null;
};

/**
 * The saved "grid" (portrait cover) pick for every library game, in one
 * query -- called once per games-list render rather than once per game.
 */
async function getPosterMap(): Promise<Map<string, string>> {
  const rows = await prisma.gameArtwork.findMany({
    where: { kind: "grid" },
    select: { system: true, romStem: true, imageUrl: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) map.set(`${r.system}/${r.romStem}`, r.imageUrl);
  return map;
}

// Same confidence bar gameArtworkAuto.ts uses for a real match, not a
// coincidental one. Needed because a job/wishlist title and a library title
// for the exact same game don't always share gameKeyOf's exact-match key --
// confirmed live (2026-09-04): a stuck "DreamWorks Madagascar (PS2)" retry
// job sat forever alongside the already-owned "DreamWorks Madagascar (USA)
// (v3.01)" library copy, since gameKeyOf saw those as two different titles.
// Comparing cleaned titles catches this without a real duplicate-title
// collision (two different games rarely score this high).
const ALREADY_OWNED_SIMILARITY = 0.72;

function findOwnedMatch(
  items: Map<string, GameListItem>,
  platformSlug: string,
  rawTitle: string
): GameListItem | undefined {
  const cleaned = romSearchTitle(rawTitle);
  for (const item of items.values()) {
    if (item.status !== "library" || item.platformSlug !== platformSlug) continue;
    if (titleSimilarity(cleaned, item.displayTitle) >= ALREADY_OWNED_SIMILARITY) return item;
  }
  return undefined;
}

/** Everything gamarr currently knows about, merged into one list. */
export async function getGamesList(): Promise<GameListItem[]> {
  const [rawLibrary, downloads, wishlist, posters] = await Promise.all([
    getGameLibrary(),
    getGameDownloads(),
    getWishlist(),
    getPosterMap(),
  ]);
  // Junk entries (a BIOS file), mislabeled ones (PS3's own USRDIR folder
  // standing in for the game), and raw+compressed duplicate pairs -- see
  // gameLibraryCleanup.ts for why gamarr's own scan can't be trusted as-is.
  const library = cleanLibrary(rawLibrary);

  const items = new Map<string, GameListItem>();

  // Library first: a game already on disk is "library" status even if a
  // stale wishlist/job entry for it still lingers (gamarr doesn't always
  // clean those up promptly -- confirmed live, a completed PS2 title's job
  // stayed in /api/downloads after import).
  for (const g of library) {
    const key = gameKeyOf(g.system, g.fileName);
    items.set(key, {
      gameKey: key,
      title: g.fileName,
      // romStem, not fileName -- fileName still carries the extension for a
      // raw (not-yet-compressed) file, and romSearchTitle only strips
      // parenthesized/bracketed noise, not extensions.
      displayTitle: romSearchTitle(g.romStem),
      platform: g.platform,
      platformSlug: g.system,
      status: "library",
      progress: null,
      system: g.system,
      romStem: g.romStem,
      sizeBytes: g.sizeBytes,
      posterUrl: posters.get(`${g.system}/${g.romStem}`) ?? null,
      wishlistId: null,
      jobId: null,
      error: null,
    });
  }

  for (const d of downloads) {
    const platformSlug = platformToSlug(d.platform);
    const key = gameKeyOf(platformSlug, d.title);
    if (items.has(key)) continue; // already-owned copy takes precedence
    if (findOwnedMatch(items, platformSlug, d.title)) continue;
    items.set(key, {
      gameKey: key,
      title: d.title,
      displayTitle: romSearchTitle(d.title),
      platform: d.platform,
      platformSlug: platformToSlug(d.platform),
      status: d.status === "completed" ? "library" : d.status,
      progress: d.progress,
      system: null,
      romStem: null,
      sizeBytes: null,
      posterUrl: null,
      wishlistId: null,
      jobId: d.jobId,
      error: d.error,
    });
  }

  for (const w of wishlist) {
    const key = gameKeyOf(w.platformSlug, w.title);
    if (items.has(key)) continue; // already represented by a job or a file
    if (findOwnedMatch(items, w.platformSlug, w.title)) continue;
    items.set(key, {
      gameKey: key,
      title: w.title,
      displayTitle: romSearchTitle(w.title),
      platform: w.platform,
      platformSlug: w.platformSlug,
      status: "queued",
      progress: null,
      system: null,
      romStem: null,
      sizeBytes: null,
      posterUrl: null,
      wishlistId: w.id,
      jobId: null,
      error: null,
    });
  }

  return Array.from(items.values());
}

// Downloads report a display platform name ("PS2"), not gamarr's slug
// ("ps2") -- the only place across these three surfaces that's true. This is
// a best-effort recovery (lowercase, strip spaces) since /api/downloads
// carries no slug field at all; wrong only skews which key a download
// de-dupes against, never which game it's about (title still identifies it).
function platformToSlug(platform: string): string {
  return platform.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function getGameByKey(key: string): Promise<GameListItem | null> {
  const all = await getGamesList();
  return all.find((g) => g.gameKey === key) ?? null;
}

/** Total bytes gamarr's library holds -- for the admin storage chart. */
export async function getGamesStorageSize(): Promise<number> {
  const library = await getGameLibrary();
  return library.reduce((sum, g) => sum + (g.sizeBytes ?? 0), 0);
}
