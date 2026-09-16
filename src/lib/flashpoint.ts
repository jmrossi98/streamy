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
 * The shelves shown when browsing the archive.
 *
 * Curated titles rather than a genre query, because the API has no notion of
 * popularity -- no play counts, no ratings, not even a sort parameter, only
 * LIMIT. A raw `tags=Platformer` query returns whichever rows the database
 * happens to reach first, which in practice means obscure entries nobody has
 * heard of. Naming the games is the only way to get recognisable ones.
 *
 * Each title is looked up individually and the best match kept, so a row is a
 * list of actual games rather than a guess at what a genre contains.
 */
export const POPULAR_ROWS: { title: string; games: string[] }[] = [
  {
    title: "All-Time Popular",
    games: [
      "The Impossible Quiz", "Line Rider", "Bloons TD", "Stick RPG", "Learn to Fly",
      "Achievement Unlocked", "QWOP", "Raze", "Alien Hominid", "Interactive Buddy",
      "N: The Way", "Age of War", "Portal: The Flash Version", "Duck Life", "Epic Battle Fantasy", "Sift Heads",
    ],
  },
  {
    title: "Platformers",
    games: [
      "Super Mario 63", "Fancy Pants Adventure", "Meat Boy", "Vex", "Red Ball",
      "Electricman 2", "Fireboy and Watergirl", "Canabalt", "Icy Tower", "This Is the Only Level",
      "Robot Wants Kitty", "Winterbells", "Chibi Knight", "Raft Wars", "William and Sly",
    ],
  },
  {
    title: "Action & Adventure",
    games: [
      "Alien Hominid", "Madness Interactive", "Thing Thing", "Territory War", "Riddle School",
      "Motherload", "South Park Character Creator", "Zombotron", "Vertical Drop Heroes", "Penguins Attack 2",
      "Hobo", "Bob the Robber", "Great Basement Escape",
    ],
  },
  {
    title: "Shooters",
    games: [
      "Raze", "Sift Heads", "Boxhead", "Bowman", "Sift Heads World",
      "Thing Thing Arena 2", "Dead Zed", "Dogfight", "Clear Vision 2", "Scope: First Blood",
      "Tactical Assassin 2", "Swords and Sandals 2",
    ],
  },
  {
    title: "Tower Defense & Strategy",
    games: [
      "Bloons TD", "Kingdom Rush", "Gemcraft", "Age of War", "The Last Stand",
      "Desktop Tower Defense", "Warlords", "Flash Element TD", "Warfare 1917", "Sonny 2",
      "Epic War", "Stick War", "Xeno Tactic", "Miragine War",
    ],
  },
  {
    title: "Puzzle & Physics",
    games: [
      "Crush the Castle", "Doodle God", "Bubble Trouble", "Bloxorz", "Fantastic Contraption 2",
      "Snail Bob", "The World's Hardest Game", "Cargo Bridge", "Feed Us", "Sushi Cat",
      "Factory Balls", "Chronotron",
    ],
  },
  {
    title: "Racing & Sports",
    games: [
      "Coaster Racer", "Stunt Dirt Bike", "Battle Gear 2", "Nuclear Outrun", "Dune Buggy",
      "Penalty Fever", "DX Hockey", "Billiard Blitz 2", "Billiards", "Basket Balls",
      "Homerun in Berzerk Land",
    ],
  },
  {
    title: "Skill & Reflex",
    games: [
      "Hedgehog Launch", "Toss the Turtle", "Wake Up the Box", "Hanger", "Boombot",
      "Blosics", "Blosics 2", "Perfect Balance 2", "Super Stacker 2", "Gravitex 2",
      "Meteor Launch", "Roly-Poly Cannon 2", "Drunken Masters",
    ],
  },
];

/**
 * Looks up one curated title and returns the best match.
 *
 * "Best" is the shortest title containing the query, which reliably prefers
 * the original over its sequels, clones and parodies -- searching "Bloons"
 * otherwise returns a dozen "Bloons Tower Defense 5 Hacked" entries before the
 * game itself.
 */
export async function findByTitle(title: string): Promise<FlashpointGame | null> {
  const hits = (await searchFlashpoint(title, 15)).filter(isPlayableHere);
  if (hits.length === 0) return null;

  const wanted = title.toLowerCase();
  const contains = hits.filter((g) => g.title.toLowerCase().includes(wanted));
  const pool = contains.length > 0 ? contains : hits;
  return pool.reduce((best, g) => (g.title.length < best.title.length ? g : best));
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

const TRUSTED_MIRROR_HOSTS = [
  "kongregate.com",
  "armorgames.com",
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

function isTrustedMirror(path: string): boolean {
  const lower = path.toLowerCase();
  return TRUSTED_MIRROR_HOSTS.some((host) => lower.includes(`/${host}/`) || lower.includes(`.${host}/`));
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

  const trusted = pool.filter((e) => isTrustedMirror(e.path));
  const finalPool = trusted.length > 0 ? trusted : pool;

  return finalPool.reduce((best, e) => (e.size > best.size ? e : best)).path;
}
