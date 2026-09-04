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
