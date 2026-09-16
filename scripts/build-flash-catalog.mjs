/**
 * Builds the Flash games catalogue that the Games tab browses.
 *
 * Run by hand, output committed: `node scripts/build-flash-catalog.mjs`
 *
 * Why a generated file rather than live queries. The tab used to resolve every
 * shelf title against Flashpoint on each page load -- around a hundred searches
 * per view of /games, against a volunteer-run service, to render the same rows
 * every time. It was also slow, it broke whenever the archive was briefly
 * unreachable, and it could only ever show titles someone had hand-listed in
 * POPULAR_ROWS.
 *
 * Andkon Arcade is used as the source of *which* games to carry. It is a
 * curated arcade of ~4,700 titles sorted into eleven categories, with a
 * per-category "Andkon's Picks" shelf that is the closest thing to a
 * popularity signal in reach -- Flashpoint itself has none: no play counts, no
 * ratings, not even a sort parameter. Andkon's editorial judgement is the
 * ordering.
 *
 * Every title is then resolved against Flashpoint (which is where the files
 * actually come from) and kept only if all of these hold:
 *
 *   - it matches a Flash entry in the `arcade` library, not `theatre`
 *     (Flashpoint files animations and video loops alongside games)
 *   - its GameZIP actually downloads -- a 404 here is common and is exactly
 *     what produced "Couldn't download from Flashpoint" on entries whose
 *     metadata said "Playable"
 *   - it carries none of Flashpoint's adult tags
 *
 * So the shelves can only ever offer something that plays, which is the whole
 * point of doing this offline instead of at render time.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "lib", "data", "flashCatalog.json");

const ANDKON = "https://www.andkon.com/arcade";
const FLASHPOINT = "https://db-api.unstable.life";

/** Politeness cap on concurrent requests to a volunteer-run archive. */
const CONCURRENCY = 6;

/**
 * Andkon's categories, in the order they should appear, with the display names
 * this site uses. Andkon's own names ("Fly 'n' Shoot Games", "Missile
 * Defender Games") are idiosyncratic to the point of being unsearchable, so
 * they are renamed to what someone browsing would actually look for.
 */
const CATEGORIES = [
  { key: "action", andkon: "adventureaction", title: "Action & Adventure" },
  { key: "puzzle", andkon: "puzzle", title: "Puzzle" },
  { key: "skill", andkon: "obstacles", title: "Obstacle & Skill" },
  { key: "defense", andkon: "missiledefender", title: "Tower Defense & Strategy" },
  { key: "shooter", andkon: "shooter", title: "Shooters" },
  { key: "blocks", andkon: "tetris", title: "Tetris & Block" },
  { key: "sport", andkon: "sport", title: "Sports" },
  { key: "racing", andkon: "racing", title: "Racing & Driving" },
  { key: "reflex", andkon: "mousegames", title: "Mouse & Quick Reflex" },
  { key: "other", andkon: "other", title: "Oddities" },
  { key: "casino", andkon: "casino", title: "Cards & Casino" },
];

/**
 * Flashpoint's own adult tags. Checked against the entry's tags rather than
 * against its title: a title blocklist is both leakier (it only catches what
 * someone thought to list) and prone to false positives on innocent games.
 */
const ADULT_TAGS = new Set(
  [
    "adult", "sexual content", "nudity", "porn", "pornographic", "hentai",
    "erotic", "eroge", "sex", "nsfw", "strip", "fetish", "bdsm",
  ].map((t) => t.toLowerCase())
);

async function retryingFetch(url, init, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
    } catch (err) {
      if (attempt === tries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 750));
    }
  }
}

/** Runs `work` over `items` with a fixed number of workers. */
async function pooled(items, work, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await work(items[i], i);
        if (++done % 100 === 0) onProgress?.(done, items.length);
      }
    })
  );
  return results;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "-")
    .trim();
}

/** Every game Andkon lists, from the one page that has all of them. */
async function fetchAndkonCatalogue() {
  const res = await retryingFetch(`${ANDKON}/gamelist.php`);
  const html = await res.text();
  const re = /href="\/arcade\/([a-z0-9]+)\/([a-z0-9._-]+)\/"[^>]*>([^<]+)</g;
  const byCategory = new Map();
  for (const m of html.matchAll(re)) {
    const [, category, slug, rawTitle] = m;
    const title = decodeEntities(rawTitle);
    if (!title) continue;
    const list = byCategory.get(category) ?? [];
    list.push({ slug, title });
    byCategory.set(category, list);
  }
  return byCategory;
}

/**
 * Andkon's "all the great games that were once featured" page, oldest first.
 *
 * This is the site's own history of what it put on its front page, 258 games
 * deep, and it is a far better answer to "all-time popular" than the
 * per-category picks are: those are a current rotation, so building the row
 * from them opened it with whatever Andkon happens to be featuring in each
 * genre this month.
 *
 * Reversed, because the page runs newest-featured first and the tail is the
 * era-defining end of it -- Stick RPG, Fancy Pants Adventure, N, Chaos
 * Faction. "All-Time Popular" should open there rather than on this year's
 * additions.
 */
async function fetchAllTimeFeatured() {
  const res = await retryingFetch(`${ANDKON}/page2.php`);
  const html = await res.text();
  const re = /href="\/arcade\/([a-z0-9]+)\/([a-z0-9._-]+)\/"/g;
  const slugs = [...new Set([...html.matchAll(re)].map((m) => m[2]))];
  slugs.reverse();
  return new Map(slugs.map((slug, i) => [slug, i]));
}

/**
 * The slugs in a category's "Andkon's Picks" shelf.
 *
 * Picks appear again in the full list below the divider, so the page is split
 * on the divider rather than deduplicated afterwards.
 */
async function fetchPicks(andkonCategory) {
  const res = await retryingFetch(`${ANDKON}/${andkonCategory}/`);
  const html = await res.text();
  const divider = html.indexOf("All of 'em");
  const head = divider > 0 ? html.slice(0, divider) : html;
  const re = new RegExp(`href='/arcade/${andkonCategory}/([a-z0-9._-]+)/'`, "g");
  // Ordered, not a Set of convenience: the order is the signal.
  return [...new Set([...head.matchAll(re)].map((m) => m[1]))];
}

function isAdult(tags) {
  return tags.some((t) => ADULT_TAGS.has(String(t).toLowerCase()));
}

/**
 * The Flashpoint entry for an Andkon title, or null.
 *
 * "Best" is the shortest title containing the query, same rule the site used
 * before: it reliably prefers the original over its sequels, clones and
 * parodies. Entries are restricted to the Flash platform and the arcade
 * library first, so a Shockwave port or an animation of the same name can't
 * win the match.
 */
async function resolve(title) {
  const params = new URLSearchParams({ title, limit: "20" });
  const res = await retryingFetch(`${FLASHPOINT}/search?${params}`);
  if (!res.ok) return null;
  const raw = await res.json().catch(() => null);
  if (!Array.isArray(raw)) return null;

  const playable = raw.filter(
    (g) =>
      g?.id &&
      g?.title &&
      String(g.platform ?? "").toLowerCase() === "flash" &&
      String(g.library ?? "arcade").toLowerCase() === "arcade"
  );
  if (playable.length === 0) return null;

  const wanted = title.toLowerCase();
  const contains = playable.filter((g) => g.title.toLowerCase().includes(wanted));
  const pool = contains.length > 0 ? contains : playable;
  const best = pool.reduce((a, g) => (g.title.length < a.title.length ? g : a));

  const tags = Array.isArray(best.tags) ? best.tags.filter((t) => typeof t === "string") : [];
  if (isAdult(tags)) return null;

  return {
    id: best.id,
    title: best.title,
    developer: best.developer || "",
    tags,
  };
}

/** Whether Flashpoint actually holds a downloadable GameZIP for this entry. */
async function hasDownload(id) {
  try {
    const res = await retryingFetch(`${FLASHPOINT}/get?id=${encodeURIComponent(id)}`, {
      method: "HEAD",
    }, 2);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  process.stdout.write("Fetching Andkon catalogue... ");
  const byCategory = await fetchAndkonCatalogue();
  const allTimeRank = await fetchAllTimeFeatured();
  const totalListed = [...byCategory.values()].reduce((n, l) => n + l.length, 0);
  console.log(`${totalListed} games across ${byCategory.size} categories`);

  const catalogue = [];
  const seenIds = new Set();
  let checked = 0;
  let kept = 0;

  for (const category of CATEGORIES) {
    const listed = byCategory.get(category.andkon) ?? [];
    if (listed.length === 0) {
      console.log(`  ${category.title}: nothing listed, skipping`);
      continue;
    }
    const picks = await fetchPicks(category.andkon);
    const pickSet = new Set(picks);

    process.stdout.write(`  ${category.title}: resolving ${listed.length}... `);
    const resolved = await pooled(listed, async (entry) => {
      checked++;
      const andkon = `${category.andkon}/${entry.slug}`;
      const pick = pickSet.has(entry.slug);
      const game = await resolve(entry.title);

      // Flashpoint has it and will hand it over: take its metadata, and keep
      // the Andkon path too as a fallback for the download.
      if (game && (await hasDownload(game.id))) {
        return { ...game, andkon, pick, allTime: allTimeRank.get(entry.slug) };
      }

      // Otherwise Andkon is the only source. About half the catalogue lands
      // here -- either no Flashpoint entry at all, or one whose GameZIP 404s.
      // Dropping these is what made "The Game Game" unfindable despite being
      // right there on Andkon. Metadata is just the title; the SWF header
      // fills in the rest at import.
      return {
        id: null, title: entry.title, developer: "", tags: [], andkon, pick,
        allTime: allTimeRank.get(entry.slug),
      };
    });

    // Picks first (Andkon's own editorial ordering), then the rest
    // alphabetically. Duplicates across categories are dropped so a game
    // appears on exactly one shelf.
    // Deduplicated on whichever identity the entry has. Andkon's own paths are
    // unique by construction, so an Andkon-only game can't collide.
    const games = [];
    for (const g of resolved) {
      if (!g) continue;
      const identity = g.id ?? `andkon:${g.andkon}`;
      if (seenIds.has(identity)) continue;
      seenIds.add(identity);
      games.push(g);
    }

    // Andkon's picks keep the order Andkon put them in -- that shelf is
    // hand-arranged, and it is the only popularity signal in reach. Sorting
    // the picks alphabetically threw it away and opened every row with
    // whatever started with a digit ("100% Complete", "30 Seconds").
    const pickOrder = new Map([...picks].map((slug, i) => [slug, i]));
    const rank = (g) => pickOrder.get(g.andkon.split("/")[1]) ?? Number.MAX_SAFE_INTEGER;
    games.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));

    const fromFlashpoint = games.filter((g) => g.id).length;
    kept += games.length;
    console.log(
      `kept ${games.length} (${games.filter((g) => g.pick).length} picks, ` +
        `${fromFlashpoint} via Flashpoint, ${games.length - fromFlashpoint} Andkon-only)`
    );
    catalogue.push({
      key: category.key,
      title: category.title,
      games: games.map((g) => ({
        i: g.id ?? undefined,
        t: g.title,
        d: g.developer || undefined,
        a: g.andkon,
        p: g.pick ? 1 : undefined,
        f: g.allTime,
      })),
    });
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({ generated: new Date().toISOString(), categories: catalogue }, null, 0) + "\n"
  );
  console.log(`\nChecked ${checked} titles, kept ${kept}. Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
