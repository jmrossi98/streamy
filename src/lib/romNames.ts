/**
 * Pure helpers for reasoning about ROM filenames.
 *
 * Deliberately its own module rather than living in gamarr.ts: that file
 * reads process.env at module scope and is server-only, so a client component
 * importing a runtime value from it would drag server code into the browser
 * bundle. These are used on both sides (the artwork picker in the browser,
 * the library mapper on the server), so they need a home with no env access
 * and no imports of their own.
 */

/**
 * A ROM's filename minus its extension -- the stable identity an artwork
 * override is keyed by.
 *
 * Deliberately not the full filename. The mediabox-side compressor
 * (scripts/rom-compress.sh) rewrites .bin/.iso/.cue to .chd in place once a
 * download lands, which changes the filename while being the same game, so an
 * override keyed on the extension would silently stop applying the moment
 * that ran -- and it runs hourly.
 */
export function romStemOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * Strips the release-name noise a ROM filename carries, so a SteamGridDB
 * search starts from something close to the real game title:
 * "DreamWorks Madagascar (USA) (v3.01)" -> "DreamWorks Madagascar".
 *
 * Only ever a starting point -- the picker's search box stays editable,
 * because no amount of cleaning turns a badly-named rip into the right query,
 * and letting a person fix exactly that case is the whole reason the picker
 * exists.
 */
export function romSearchTitle(stem: string): string {
  return stem
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lowercase, punctuation-stripped comparison form of a title -- for matching
 * the *same* game across gamarr's three separate surfaces (wishlist, active
 * downloads, library scan), which don't share any other common id. "Crash
 * Bash & Spyro: Year of the Dragon" and "Crash Bash and Spyro Year of the
 * Dragon" collapse to the same key.
 */
function normalizeGameTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Stable identity for a game across its whole lifecycle -- wishlisted, then
 * downloading, then in the library -- none of which share a common id from
 * gamarr itself. Used for routing (/games/[key]), the games watchlist, and
 * merging the three gamarr surfaces into one list.
 *
 * Deliberately NOT the same key GameArtwork uses (system+ROM-stem): that key
 * only exists once a real file is on disk, so it can't identify a wishlisted
 * game that hasn't downloaded yet. The two are unrelated identity schemes for
 * two different concerns -- this module never touches GameArtwork's key.
 */
export function gameKeyOf(platformSlug: string, title: string): string {
  return `${platformSlug || "unknown"}::${normalizeGameTitle(title)}`;
}

function normalizeForSimilarity(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Character-level ratio (via a simple LCS-based similarity) combined with
 * token-set overlap -- mirrors, in spirit, the same two-signal combination
 * mediabox-infra's deck/steam_sync.py uses for its own SGDB matching, and
 * for the same reason: character ratio alone misses "the query merely
 * appears inside a much longer title" (a compilation listing the game among
 * several), and token overlap alone misses reordering/punctuation noise.
 *
 * Used by gameArtworkAuto.ts's SGDB matching -- lives here rather than
 * there specifically so it (and its test) never pull in that module's
 * Prisma import. That import broke CI once already: this repo's unit-test
 * job runs `npm ci --ignore-scripts` (skips `prisma generate`, since these
 * tests are pure and don't touch the database), so any module a pure-logic
 * test imports has to actually stay import-free of Prisma, not just
 * logically independent of it.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  // Longest common subsequence length, normalized by the longer string --
  // cheap, dependency-free stand-in for difflib.SequenceMatcher.ratio()
  // that's plenty accurate for this threshold gate (it doesn't need to be
  // exact, just consistent).
  const m = na.length;
  const n = nb.length;
  const dp = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = na[i - 1] === nb[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  const lcs = dp[n];
  const charRatio = (2 * lcs) / (m + n);

  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  return Math.max(charRatio, jaccard);
}
