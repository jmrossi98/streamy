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
  /**
   * Flashpoint's own split: "arcade" is games, "theatre" is animations and
   * video loops. Both are Flash and both "play", so nothing else here tells
   * them apart.
   */
  library: string;
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
  library?: string;
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
    library: raw.library || "arcade",
  };
}

/**
 * Flashpoint's own adult tags.
 *
 * Matched against the entry's tags rather than its title. A title blocklist
 * is both leakier -- it only catches the ones someone thought to list -- and
 * prone to false positives, and Flashpoint tags this material consistently
 * enough to use directly.
 */
const ADULT_TAGS = new Set([
  "adult", "sexual content", "nudity", "porn", "pornographic", "hentai",
  "erotic", "eroge", "sex", "nsfw", "strip", "fetish", "bdsm",
]);

/**
 * Whether an entry belongs on a household media server.
 *
 * Two separate exclusions, both needed:
 *
 *   - adult-tagged entries. Flashpoint preserves everything the web had,
 *     pornography included, and a raw title search surfaces it -- searching
 *     the archive here returned exactly that.
 *   - the `theatre` library, which is animations and video loops rather than
 *     games. They are Flash, they load in Ruffle, and they are not what
 *     anyone opening a games tab is looking for.
 */
export function isFamilyFriendly(game: FlashpointGame): boolean {
  if (game.library.toLowerCase() === "theatre") return false;
  return !game.tags.some((t) => ADULT_TAGS.has(t.toLowerCase()));
}


/**
 * One entry by its Flashpoint id.
 *
 * `/search` takes an `id` as well as a `title`, which is what lets the
 * generated catalogue store three fields per game (id, title, developer)
 * instead of a full metadata record each. Tags and description are fetched
 * here, once, at the moment someone actually opens the game.
 */
export async function findById(id: string): Promise<FlashpointGame | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const params = new URLSearchParams({ id: trimmed, limit: "1" });
  try {
    const res = await fetch(`${FLASHPOINT_API}/search?${params.toString()}`, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as RawGame[];
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const game = toFlashpointGame(raw[0]);
    // The id is what was asked for; anything else came back by accident.
    return game && game.id === trimmed ? game : null;
  } catch {
    return null;
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
  const result = await fetchFlashpointAssetDetailed(url);
  return result.ok ? result.bytes : null;
}

export type AssetFetch =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; notFound: boolean; reason: string };

/**
 * Same download, but able to say *why* it failed.
 *
 * The distinction that matters is 404 versus everything else. Plenty of
 * Flashpoint entries have full metadata -- title, tags, even status
 * "Playable" -- and no archived GameZIP behind them, so `/get` answers 404.
 * Reported as a flat "couldn't download", that looks identical to the archive
 * being down or the network dropping, and sends you to check things that are
 * working fine. It is a permanent property of the entry, and worth saying so.
 */
export async function fetchFlashpointAssetDetailed(url: string): Promise<AssetFetch> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        notFound: res.status === 404,
        reason:
          res.status === 404
            ? "Flashpoint has no archived copy of this game to download"
            : `Flashpoint returned ${res.status}`,
      };
    }
    return { ok: true, bytes: await res.arrayBuffer() };
  } catch {
    return { ok: false, notFound: false, reason: "Couldn’t reach Flashpoint" };
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
 *   - a mirror from a well-known portal wins over any other candidate
 *   - failing that, the largest survivor wins, since a loader or ad stub is
 *     tiny next to the game it loads
 *
 * The portal preference exists because "biggest wins" alone picked wrong on a
 * real title: Learn to Fly's GameZIP holds a ~1.2MB rip from a Vietnamese
 * regional mirror (content/static.game24h.vn/...) alongside ~890KB copies
 * from Kongregate and Armor Games. All three are legitimate, unmodified
 * builds -- but the regional one is bigger, purely from extra bundled assets,
 * and size alone chose it over two portals whose whole business is hosting
 * the stock, unmodified, English original. Sites known to re-host under a
 * cracked domain lock or altered balance (hackedgames.biz and similar) are
 * deliberately not on this list: swapping a user onto a "hacked" build
 * changes what they're actually playing, which is a call for a person to
 * make, not a heuristic to make silently.
 */
const NON_GAME_SWF = /(loader|preloader|ads?|advert|logo|intro|splash|banner)\.swf$/i;

/**
 * Hosts whose own builds refuse to run anywhere else.
 *
 * A domain-locked SWF asks Flash for the page's origin and, finding it isn't
 * the one it was built for, shows a "play this at ..." splash instead of the
 * game. Ruffle emulates that check faithfully and offers no way to spoof the
 * origin -- confirmed by reading Ruffle's own load-options source, which has
 * no such option -- so the only fix available is to prefer a copy that was
 * never locked in the first place.
 *
 * Every host here was observed serving a locked build in a real GameZIP:
 *
 *   - ninjakiwi.com     Bloons TD 5   -> "Play this game on ninjakiwi.com"
 *   - xgenstudios.com   Stick RPG     -> "THIS GAME HAS BEEN PIRATED FROM ..."
 *   - armorgames.com    Duck Life 4   -> Armor Games' own lock splash
 *
 * These are demoted rather than excluded: a locked copy still beats no game
 * at all when the archive holds nothing else, and it is at least honest about
 * why it won't play.
 */
const SITE_LOCKED_HOSTS = [
  "ninjakiwi.com",
  "xgenstudios.com",
  "armorgames.com",
  "notdoppler.com",
];

/**
 * Sites that re-host games with the gameplay altered.
 *
 * "Hacked" and "prehacked" arcades ship builds with unlimited money, invincible
 * players or the difficulty curve removed. They are unlocked, so by domain
 * alone they look like a perfectly good mirror -- which is exactly the trap:
 * ranked on availability they would win, and a viewer would silently get a
 * different game than the one they clicked.
 *
 * Ranked below even a locked build on purpose. A lock at least tells you
 * plainly why it won't play; a cheat build quietly changes what you're
 * playing. Bloons TD 5's archive is the case that forces the choice -- its
 * only alternative to the locked official asset is a hackedgames.biz rip.
 */
const MODIFIED_GAME_HOSTS = [
  "hackedgames.biz",
  "arcadeprehacks.com",
  "hackedarcadegames.com",
  "hackedfreegames.com",
];

const TRUSTED_MIRROR_HOSTS = [
  "kongregate.com",
  "newgrounds.com",
  "addictinggames.com",
  "miniclip.com",
  "crazygames.com",
  "coolmathgames.com",
  "y8.com",
  "flashpointarchive.org",
  // A long-running general Flash arcade, same category as the others above --
  // added after Stick RPG's archive turned out to hold only two candidates
  // otherwise: XGen Studios' own official build (domain-locked to
  // xgenstudios.com, exactly the same failure Bloons TD 5 hit) and a
  // cheat-site rip. Andkon's copy is neither.
  "andkon.com",
];

function hostedBy(path: string, hosts: string[]): boolean {
  const lower = path.toLowerCase();
  return hosts.some((host) => lower.includes(`/${host}/`) || lower.includes(`.${host}/`));
}

function isTrustedMirror(path: string): boolean {
  return hostedBy(path, TRUSTED_MIRROR_HOSTS);
}

function isSiteLocked(path: string): boolean {
  return hostedBy(path, SITE_LOCKED_HOSTS);
}

function isModifiedBuild(path: string): boolean {
  return hostedBy(path, MODIFIED_GAME_HOSTS);
}

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

  // Four tiers, best first. Within a tier the biggest wins, since a loader or
  // ad stub is tiny next to the game it loads.
  //
  //   1. a known portal that isn't a known site-locker -- the stock,
  //      unmodified, embed-anywhere copy
  //   2. anything else unlocked and unmodified -- usually a small arcade's
  //      mirror, which by the fact it worked there is not locked to someone
  //      else's domain
  //   3. a known site-locker's own build, which will very likely refuse to run
  //   4. a cheat-site rip, which will run and will not be the same game
  //
  // Every tier is there because a real archive needed it. Without (1), size
  // alone picked a Vietnamese regional rip of Learn to Fly over the Kongregate
  // original. Without (3) ranking below (2), Duck Life 4 got Armor Games'
  // locked build instead of the working mirror beside it. Without (4) ranking
  // last, Bloons TD 5 -- whose archive holds only the locked official asset
  // and a hackedgames.biz rip -- would silently serve the cheat build.
  const unlocked = (e: { path: string }) => !isSiteLocked(e.path) && !isModifiedBuild(e.path);
  const tiers = [
    pool.filter((e) => isTrustedMirror(e.path) && unlocked(e)),
    pool.filter((e) => !isTrustedMirror(e.path) && unlocked(e)),
    pool.filter((e) => !isModifiedBuild(e.path)),
    pool,
  ];
  const finalPool = tiers.find((t) => t.length > 0)!;

  return finalPool.reduce((best, e) => (e.size > best.size ? e : best)).path;
}
