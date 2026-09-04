/**
 * gamarr's own scanner surfaces some library rows that aren't real,
 * standalone games -- a BIOS file it happily treats as a ROM, PS3's own
 * USRDIR subfolder picked up as if it were a second copy of the game one
 * level in, and (until manually cleaned up on disk) a raw+compressed pair
 * of the exact same title. None of this is something gamarr can be
 * reconfigured to skip -- it's genuine scanner behavior, confirmed live
 * (2026-09-04) -- so it's filtered/repaired here before it ever reaches
 * the UI. gamarr's own scanner also never removes a stale row once a file
 * is gone (see mediabox-infra's gamarr-scan-backfill.py), so this has to
 * keep doing this on every render, not just once.
 */
import type { LibraryGame } from "./gamarr";
import { romStemOf } from "./romNames";

// Not \b\bios\b -- \b treats "_" as a word character, so it doesn't fire
// between "2" and "bios" in "ps2_bios" (confirmed by a failing test: the
// real BIOS file on disk is literally named "ps2_bios.zip"). Lookarounds
// against just letters/digits treat "_" as a delimiter too.
const JUNK_TITLE_PATTERNS = [/(?<![a-z0-9])bios(?![a-z0-9])/i];

/** Sony's own fixed internal folder names for a disc/PKG-structured PS3
 *  game -- never a real game title on their own, always a sign gamarr
 *  recursed one level too far into a folder-structured game. */
const GENERIC_CONTAINER_NAMES = new Set(["USRDIR", "PS3_GAME", "PS3_UPDATE", "PS3_DISC.SFB"]);

export function isJunkLibraryItem(item: LibraryGame): boolean {
  return JUNK_TITLE_PATTERNS.some((p) => p.test(item.fileName) || p.test(item.filePath));
}

/**
 * When gamarr's own title is a generic container folder name, recover the
 * real game name from its ancestor directory instead of showing "USRDIR"
 * as if that were the game -- the real title is whatever folder sits just
 * above the first Sony-fixed segment in the path.
 */
export function repairGenericTitle(item: LibraryGame): string {
  if (!GENERIC_CONTAINER_NAMES.has(item.fileName)) return item.fileName;
  const parts = item.filePath.split(/[\\/]/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!GENERIC_CONTAINER_NAMES.has(parts[i])) return parts[i];
  }
  return item.fileName;
}

const COMPRESSED_EXTENSIONS = new Set(["chd", "rvz"]);
// Order matters: the compound ".nkit.iso"/".nkit.rvz" must be tried before
// the plain single extensions below it, or "X.nkit.iso" would only have
// ".iso" stripped and be compared under a base of "X.nkit" instead of "X".
const EXTENSION_PATTERN = /\.(nkit\.iso|nkit\.rvz|iso|ciso|bin|cue|chd|rvz)$/i;

function realBaseAndExt(filePath: string): { base: string; ext: string } | null {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const m = name.match(EXTENSION_PATTERN);
  if (!m) return null;
  return { base: name.slice(0, m.index).toLowerCase(), ext: m[1].toLowerCase() };
}

/**
 * Drops the raw copy of any title that also has a compressed sibling on
 * disk (same base filename, e.g. "Foo (USA).iso" next to "Foo (USA).chd")
 * -- these are the exact same game, and the compressed one is always the
 * one actually meant to stay (matches every manual cleanup done this
 * session: Wind Waker, Metroid Prime, the SpongeBob titles, Mario Galaxy).
 * A file whose extension isn't recognized at all is left untouched.
 */
export function dedupeCompressedSiblings(items: LibraryGame[]): LibraryGame[] {
  const groups = new Map<string, LibraryGame[]>();
  for (const item of items) {
    const parsed = realBaseAndExt(item.filePath);
    const key = parsed ? `${item.system}::${parsed.base}` : `unmatched::${item.id}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const out: LibraryGame[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) {
      out.push(...group);
      continue;
    }
    const compressed = group.filter((g) => {
      const parsed = realBaseAndExt(g.filePath);
      // .endsWith, not a Set lookup -- the compound "nkit.rvz" needs to
      // count as compressed too, not just the bare "rvz" it ends with.
      if (!parsed) return false;
      return [...COMPRESSED_EXTENSIONS].some((ext) => parsed.ext.endsWith(ext));
    });
    out.push(...(compressed.length > 0 ? compressed : group));
  }
  return out;
}

/** Applies every cleanup pass above, in the order that makes sense:
 *  junk out first so it never has to be considered for dedup, then title
 *  repair, then dedup last since it needs the (now-repaired) real names. */
export function cleanLibrary(items: LibraryGame[]): LibraryGame[] {
  const withoutJunk = items.filter((i) => !isJunkLibraryItem(i));
  const withRepairedTitles = withoutJunk.map((i) => {
    const fileName = repairGenericTitle(i);
    // romStem is what an artwork pick is keyed by (see LibraryGame) -- every
    // repaired item shared the literal fileName "USRDIR" before this, which
    // would have collided across every PS3 title's artwork. Recomputing it
    // here from the repaired name is a real fix, not just cosmetic.
    return fileName === i.fileName ? i : { ...i, fileName, romStem: romStemOf(fileName) };
  });
  return dedupeCompressedSiblings(withRepairedTitles);
}
