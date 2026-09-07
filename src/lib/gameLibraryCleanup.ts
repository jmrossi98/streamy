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

// Standalone emulator installers/executables that land in a ROMs folder
// (Cemu.exe was found sitting directly in /data/roms/wiiu/, presumably
// left behind by a bundled "game + emulator" download like the Red Dead
// Redemption Switch one from earlier) -- gamarr's scanner has no concept
// of "this is a program, not a ROM", it just sees a recognized extension.
const KNOWN_EMULATOR_NAMES = new Set([
  "cemu", "ryujinx", "yuzu", "dolphin", "pcsx2", "rpcs3", "retroarch",
  "duckstation", "ppsspp", "citra", "vita3k", "xemu", "redream", "mgba", "bizhawk",
]);

function isEmulatorExecutable(filePath: string): boolean {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const m = name.match(/^(.+?)\.(exe|app|appimage|dmg|zip|rar|7z)$/i);
  return !!m && KNOWN_EMULATOR_NAMES.has(m[1].toLowerCase());
}

/**
 * A Switch *update folder* sitting beside the base game it patches.
 *
 * Confirmed live: "Mario Party Superstars" showed twice -- once as the base
 * game `Mario Party Superstars[01006FE013472000][v0].nsp`, and once as a
 * bare folder `Mario Party Superstars/` whose contents are the update
 * (`...[01006FE013472800][v131072].nsp` -- Switch's convention is base
 * title-id + 0x800 for an update). Same shape for Red Dead Redemption.
 *
 * The update is genuinely needed on disk, so this filters it out of the
 * *list* rather than deleting anything -- only the base game is a game to
 * show. Detected by the folder having no cartridge extension of its own,
 * since gamarr reports the directory itself as the item and the version tag
 * lives on the file inside, not on the folder.
 */
function isSwitchUpdateFolder(item: LibraryGame): boolean {
  if (item.system !== "switch") return false;
  return !/\.(nsp|xci|nsz)$/i.test(item.filePath);
}

/**
 * One track of a multi-track disc image, which is part of a game rather than
 * a game.
 *
 * A CD rip is a single `.cue` alongside `<title> (Track NN).bin` for every
 * track, and gamarr's scanner indexes each `.bin` as its own library entry --
 * so one game appears as many identical tiles. Confirmed live twice: Nights
 * into Dreams showed up 21 times (21 tracks) and Mega Man 8 three times.
 *
 * Filtered here rather than only at the source because *anything* writing
 * rows into gamarr's table can reintroduce them -- gamarr's own scanner did
 * exactly that after the importer was fixed -- and this is the one place
 * every path into the UI goes through.
 *
 * Deliberately requires the `(Track NN)` marker: a lone `.bin` with a
 * sibling `.cue` and no track suffix is the whole disc, not a fragment.
 */
function isDiscTrackFragment(item: LibraryGame, all: LibraryGame[]): boolean {
  const name = item.filePath.split(/[\\/]/).pop() ?? "";
  const m = name.match(/^(.*?)\s*\(Track\s*\d+\)\.bin$/i);
  if (!m) return false;
  const cuePath = item.filePath.slice(0, item.filePath.length - name.length) + `${m[1]}.cue`;
  return all.some((o) => o.filePath === cuePath);
}

/** The staging area, if it ever ends up inside the scanned tree again.
 *  gamarr indexes every directory under the ROM root, so a drop folder there
 *  surfaces its own per-system subdirectories as games ("ps2", "ps3" on a
 *  platform called "_INBOX"). The real fix moved the folder out of
 *  /data/roms entirely; this makes a regression invisible rather than
 *  user-facing. */
function isStagingPath(filePath: string): boolean {
  return /(^|\/)_inbox(\/|$)|(^|\/)roms-inbox(\/|$)/i.test(filePath);
}

export function isJunkLibraryItem(item: LibraryGame): boolean {
  if (JUNK_TITLE_PATTERNS.some((p) => p.test(item.fileName) || p.test(item.filePath))) return true;
  if (isSwitchUpdateFolder(item)) return true;
  if (isStagingPath(item.filePath)) return true;
  return isEmulatorExecutable(item.filePath);
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

export type DiscInfo = { label: string; romStem: string; sizeBytes: number | null };

/** A grouped multi-disc game carries the rest of LibraryGame from its lowest
 *  (representative) disc, plus every disc it was assembled from. Absent
 *  entirely for a single-disc game -- checking `"discs" in item` (or just
 *  truthiness) is how a caller tells the two apart. */
export type LibraryGameWithDiscs = LibraryGame & { discs?: DiscInfo[] };

const DISC_PATTERN = /\(disc\s*(\d+)\)/i;

/**
 * Groups "Final Fantasy VIII (USA) (Disc 1)".."(Disc 4)" into one entry
 * instead of four separate tiles. This was already happening *visually* by
 * accident -- romSearchTitle strips every parenthesized group, so all four
 * already rendered as the identical text "Final Fantasy VIII" -- but each
 * still got its own tile, its own (independently auto-matched, sometimes
 * inconsistent) artwork, and its own gameKey. Grouping makes that one real
 * game everywhere, not just in the label.
 *
 * The lowest-numbered disc becomes the representative: its system/romStem
 * is what artwork/title overrides and the gameKey are keyed by, so an
 * override already saved against "(Disc 1)" (the common case -- disc 1 is
 * what most matching/picking has always pointed at) keeps working with no
 * migration needed. sizeBytes is summed across every disc, since that's a
 * more honest answer to "how much space does this game use" than disc 1's
 * size alone.
 */
export function groupMultiDiscGames(items: LibraryGame[]): LibraryGameWithDiscs[] {
  const groups = new Map<string, LibraryGame[]>();
  const singles: LibraryGameWithDiscs[] = [];
  for (const item of items) {
    const m = item.fileName.match(DISC_PATTERN);
    if (!m) {
      singles.push(item);
      continue;
    }
    const groupTitle = item.fileName.replace(DISC_PATTERN, "").replace(/\s+/g, " ").trim();
    const key = `${item.system}::${groupTitle.toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const out = [...singles];
  for (const discs of groups.values()) {
    if (discs.length < 2) {
      // A lone "(Disc 1)" with no siblings -- nothing to group, leave it as
      // its own (still disc-labeled) entry rather than inventing a group.
      out.push(...discs);
      continue;
    }
    const byNumber = [...discs].sort((a, b) => {
      const na = Number(a.fileName.match(DISC_PATTERN)?.[1] ?? 0);
      const nb = Number(b.fileName.match(DISC_PATTERN)?.[1] ?? 0);
      return na - nb;
    });
    const representative = byNumber[0];
    const discInfos: DiscInfo[] = byNumber.map((d) => ({
      label: `Disc ${d.fileName.match(DISC_PATTERN)?.[1] ?? "?"}`,
      romStem: d.romStem,
      sizeBytes: d.sizeBytes,
    }));
    const totalSize = byNumber.reduce((sum, d) => sum + (d.sizeBytes ?? 0), 0);
    out.push({
      ...representative,
      sizeBytes: totalSize > 0 ? totalSize : representative.sizeBytes,
      discs: discInfos,
    });
  }
  return out;
}

/** Applies every cleanup pass above, in the order that makes sense: junk out
 *  first so it never has to be considered for dedup or grouping, then title
 *  repair, then dedup, then disc grouping last since it needs the
 *  (now-deduped) real files -- a raw+compressed duplicate pair on one disc
 *  would otherwise turn into a group with a spurious extra "disc". */
export function cleanLibrary(items: LibraryGame[]): LibraryGameWithDiscs[] {
  // Track fragments need the whole list to find their sibling .cue, so they
  // are filtered separately from the per-item junk checks.
  const withoutJunk = items.filter(
    (i) => !isJunkLibraryItem(i) && !isDiscTrackFragment(i, items)
  );
  const withRepairedTitles = withoutJunk.map((i) => {
    const fileName = repairGenericTitle(i);
    // romStem is what an artwork pick is keyed by (see LibraryGame) -- every
    // repaired item shared the literal fileName "USRDIR" before this, which
    // would have collided across every PS3 title's artwork. Recomputing it
    // here from the repaired name is a real fix, not just cosmetic.
    return fileName === i.fileName ? i : { ...i, fileName, romStem: romStemOf(fileName) };
  });
  return groupMultiDiscGames(dedupeCompressedSiblings(withRepairedTitles));
}
