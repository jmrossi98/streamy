/**
 * Which usenet release, if any, is a given game for a given console. Pure.
 *
 * A Prowlarr search for a game's name brings back every port of it -- the PC
 * repack, the PS4 remaster, the soundtrack, the 1.2.0 update -- and console
 * releases say what they are only in their name. So a release counts only
 * when its name carries the console's tag (gameSystems.ts), carries no other
 * console's, is not an update, DLC or other add-on, and, with its tags and
 * group stripped, names the same game: titleSimilarity, which also refuses
 * a different number in a series (Final Fantasy V is not Final Fantasy VI).
 */
import { GAME_SYSTEMS, type GameSystem } from "./gameSystems";
import { titleSimilarity } from "./romNames";

export type ReleaseResult = {
  title: string;
  protocol: string;
  size?: number | null;
  seeders?: number | null;
  grabs?: number | null;
  indexer?: string | null;
  publishDate?: string | null;
  downloadUrl?: string | null;
  guid?: string | null;
};

export type RankedRelease<T extends ReleaseResult = ReleaseResult> = { release: T; score: number; similarity: number };

/** Something other than the game itself. */
const NOT_THE_GAME =
  /\b(?:updates?|patch(?:ed)?|dlcs?|add[ ._-]?ons?|season[ ._-]?pass|trainer|crack(?:fix)?|keygen|soundtracks?|ost|artbook|demo|themes?|avatars?|cheats?|save[ ._-]?(?:game|data)?|guide|manual|wallpapers?|unlocker|mods?|translation|hack|emulator|bios|firmware|sdk)\b/i;

/** PC repackers and scene groups: a console name in their titles names a port, not the console. */
const PC_RELEASE = /\b(?:fitgirl|dodi|codex|skidrow|reloaded|plaza|empress|tenoke|rune|razor1911|flt|gog|elamigos|kaos|xatab)\b/i;

/** Region words: a release for one of these is wanted. */
const WANTED_REGION = /\b(?:USA|US|NTSC[ ._-]?U|EUR|EU|PAL|UK|World|MULTI\d*|M\d|ENG?|English|En,)/i;
/** Region words for a release nobody here can read, unless it says it has English too. */
const FOREIGN_ONLY = /\b(?:JPN|JAP|JP|NTSC[ ._-]?J|KOR|KR|CHN|CHS|CHT|TWN)\b/i;

/** Tags and noise stripped before comparing names. Bare words that can be part of a title (World, US, Switch) are left alone. */
const TAG_WORDS =
  /\b(?:NSW|PS2DVD|PS2CD|PS1|PS2|PS3|PSX|PSP|PSV|NDS|3DS|GBA|GBC|N64|SNES|NES|NGC|WII|WIIU|WBFS|XBOX|X360|USA|EUR|PAL|NTSC(?:[ ._-]?[UJ])?|JPN|JAP|MULTI\d*|M\d|PROPER|REPACK|INTERNAL|READ[ ._-]?NFO|DUAL|REGION[ ._-]?FREE|NSP|XCI|ROM|ISO|CHD|RVZ|CSO|ENG?|English|v\d+(?:[ ._]\d+)*|Rev[ ._]?\d+|rar|zip|7z)\b/gi;
const EXTENSIONS = /\.(?:nsp|xci|iso|chd|cso|rvz|wbfs|zip|7z|rar|nds|gba|gbc|gb|sfc|smc|z64|n64|nes|cia|3ds|bin|cue|pkg)\b/gi;

/** A release name reduced to the game's name: brackets, extensions, tags and the group removed. */
export function releaseGameName(title: string): string {
  let t = title.replace(/&amp;/g, "&");
  t = t.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ");
  t = t.replace(EXTENSIONS, " ");
  t = t.replace(/[._]+/g, " ");
  t = t.replace(TAG_WORDS, " ");
  // The scene group, "-HR" or "-BigBlueBox", now at the end.
  t = t.replace(/\s*-\s*[A-Za-z0-9]+\s*$/, " ");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Whether a release's name says it is for this console, and for no other.
 * The tags already keep apart the names that contain each other ("Wii U"
 * from Wii, "PlayStation 2" from PlayStation, "Game Boy Color" from Game
 * Boy), so any second console's tag means a multi-console upload.
 */
export function isForSystem(title: string, system: GameSystem): boolean {
  if (!system.tag.test(title)) return false;
  return !GAME_SYSTEMS.some((other) => other.slug !== system.slug && other.tag.test(title));
}

/**
 * The releases that are this game for this console, best first, each with
 * why it ranks where it does. Usenet beats torrents (no seeders to wait on,
 * no swarm of renamed malware), a wanted region beats none, a foreign-only
 * one comes last, then the closest name and the most grabbed.
 */
export function rankGameReleases<T extends ReleaseResult>(
  results: T[],
  gameName: string,
  system: GameSystem,
  { minSimilarity = 0.85 }: { minSimilarity?: number } = {}
): RankedRelease<T>[] {
  const out: RankedRelease<T>[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const title = r.title.replace(/&amp;/g, "&");
    if (seen.has(`${r.protocol}:${title}`)) continue;
    seen.add(`${r.protocol}:${title}`);
    if (!isForSystem(title, system) || NOT_THE_GAME.test(title) || PC_RELEASE.test(title)) continue;
    if (r.size != null && r.size > 0 && r.size < 64 * 1024) continue;
    if (r.protocol === "torrent" && !(r.seeders && r.seeders > 0)) continue;
    const similarity = titleSimilarity(releaseGameName(title), gameName);
    if (similarity < minSimilarity) continue;
    let score = similarity * 100;
    if (r.protocol === "usenet") score += 100;
    if (WANTED_REGION.test(title)) score += 15;
    else if (FOREIGN_ONLY.test(title)) score -= 40;
    score += Math.min(10, (r.grabs ?? 0) / 5);
    out.push({ release: r, score, similarity });
  }
  return out.sort((a, b) => b.score - a.score);
}
