/**
 * The consoles Streamy can fetch games for, and every name each goes by.
 * Pure.
 *
 * One system has three vocabularies: IGDB's platform ids (what the catalog
 * says a game came out on), the folder under /data/roms that the ROM inbox
 * files it into (mediabox-infra's rom-inbox.py), and gamarr's platform name
 * (its own downloads, the torrent and direct-download fallback). Release
 * names add a fourth: the tags scene groups and uploaders put in a title
 * ("NSW", "PS2DVD", "[NGC]") -- without one a release is not trusted to be
 * for this console at all, since the same game name covers PC repacks and
 * every other port.
 */

export type GameSystem = {
  /** The ROM folder (/data/roms/<slug>) and the inbox subfolder. */
  slug: string;
  name: string;
  /** IGDB platform ids for this console (regional variants included). */
  igdbPlatforms: number[];
  /** gamarr's platform id and name, for its own queue (the torrent / direct-download fallback). */
  gamarr: { id: string; name: string };
  /** A release title is for this console only if this matches. */
  tag: RegExp;
};

export const GAME_SYSTEMS: GameSystem[] = [
  { slug: "nes", name: "NES", igdbPlatforms: [18, 99], gamarr: { id: "nes", name: "NES" }, tag: /\bNES\b|Nintendo Entertainment System|Famicom|\.nes\b/i },
  { slug: "snes", name: "SNES", igdbPlatforms: [19, 58], gamarr: { id: "snes", name: "SNES" }, tag: /\bSNES\b|Super Nintendo|Super Famicom|\.sfc\b|\.smc\b/i },
  { slug: "n64", name: "Nintendo 64", igdbPlatforms: [4], gamarr: { id: "n64", name: "Nintendo 64" }, tag: /\bN64\b|Nintendo 64|\.z64\b|\.n64\b/i },
  { slug: "gb", name: "Game Boy", igdbPlatforms: [33], gamarr: { id: "gb", name: "Game Boy" }, tag: /Game ?Boy(?! ?(?:Advance|Colou?r))|[[(]GB[\])]|\.gb\b/i },
  { slug: "gbc", name: "Game Boy Color", igdbPlatforms: [22], gamarr: { id: "gb", name: "Game Boy" }, tag: /\bGBC\b|Game ?Boy Colou?r|\.gbc\b/i },
  { slug: "gba", name: "Game Boy Advance", igdbPlatforms: [24], gamarr: { id: "gba", name: "Game Boy Advance" }, tag: /\bGBA\b|Game ?Boy Advance|\.gba\b/i },
  { slug: "nds", name: "Nintendo DS", igdbPlatforms: [20], gamarr: { id: "nds", name: "DS" }, tag: /\bNDS\b|Nintendo DS\b|\.nds\b/i },
  { slug: "3ds", name: "Nintendo 3DS", igdbPlatforms: [37], gamarr: { id: "3ds", name: "3DS" }, tag: /\b3DS\b|\.cia\b/i },
  { slug: "gamecube", name: "GameCube", igdbPlatforms: [21], gamarr: { id: "ngc", name: "GameCube" }, tag: /\bNGC\b|Game ?Cube|\.rvz\b|\.gcm\b/i },
  { slug: "wii", name: "Wii", igdbPlatforms: [5], gamarr: { id: "wii", name: "Wii" }, tag: /\bWii\b(?![ ._-]?U\b)|\bWBFS\b/i },
  { slug: "wiiu", name: "Wii U", igdbPlatforms: [41], gamarr: { id: "wiiu", name: "Wii U" }, tag: /\bWii[ ._-]?U\b|\bWUP\b/i },
  { slug: "switch", name: "Switch", igdbPlatforms: [130], gamarr: { id: "switch", name: "Switch" }, tag: /\bNSW\b|\bSwitch\b|\.nsp\b|\.xci\b/i },
  { slug: "psx", name: "PlayStation", igdbPlatforms: [7], gamarr: { id: "psx", name: "PS1" }, tag: /\bPSX\b|\bPS1\b|\bPSone\b|PlayStation(?![ ._-]?(?:[2-5]|Vita|Portable))/i },
  { slug: "ps2", name: "PlayStation 2", igdbPlatforms: [8], gamarr: { id: "ps2", name: "PS2" }, tag: /\bPS2(?:DVD|CD)?\b|PlayStation[ ._-]?2/i },
  { slug: "ps3", name: "PlayStation 3", igdbPlatforms: [9], gamarr: { id: "ps3", name: "PS3" }, tag: /\bPS3\b|PlayStation[ ._-]?3/i },
  { slug: "psp", name: "PSP", igdbPlatforms: [38], gamarr: { id: "psp", name: "PSP" }, tag: /\bPSP\b|PlayStation Portable/i },
  { slug: "psvita", name: "PS Vita", igdbPlatforms: [46], gamarr: { id: "psvita", name: "PS Vita" }, tag: /\bPS[ ._-]?Vita\b|\bPSV\b/i },
  { slug: "genesis", name: "Genesis", igdbPlatforms: [29], gamarr: { id: "genesis", name: "Sega Genesis" }, tag: /\bGenesis\b|Mega[ ._-]?Drive|\.md\b|\.gen\b/i },
  { slug: "saturn", name: "Saturn", igdbPlatforms: [32], gamarr: { id: "saturn", name: "Sega Saturn" }, tag: /\bSaturn\b/i },
  { slug: "dreamcast", name: "Dreamcast", igdbPlatforms: [23], gamarr: { id: "dc", name: "Dreamcast" }, tag: /\bDreamcast\b|[[(]DC[\])]/i },
  { slug: "xbox", name: "Xbox", igdbPlatforms: [11], gamarr: { id: "xbox", name: "Xbox" }, tag: /\bXBOX\b(?![ ._-]?(?:360|One|Series))/i },
  { slug: "xbox360", name: "Xbox 360", igdbPlatforms: [12], gamarr: { id: "xbox360", name: "Xbox 360" }, tag: /\bX360\b|XBOX[ ._-]?360/i },
];

const BY_SLUG = new Map(GAME_SYSTEMS.map((s) => [s.slug, s]));

/** Other folder names a console's games are found under (a symlink, an older layout). */
const FOLDER_ALIASES: Record<string, string[]> = { gamecube: ["gc"], genesis: ["megadrive"], "3ds": ["n3ds"], psx: ["ps1"] };

/** Every /data/roms folder a console's games can sit in. */
export function systemFolders(system: GameSystem): string[] {
  return [system.slug, ...(FOLDER_ALIASES[system.slug] ?? [])];
}

export function systemBySlug(slug: string | null | undefined): GameSystem | null {
  return (slug && BY_SLUG.get(slug)) || null;
}

/** The systems an IGDB game came out on that Streamy can fetch for, in table order. */
export function systemsForIgdbPlatforms(platformIds: number[]): GameSystem[] {
  const ids = new Set(platformIds);
  return GAME_SYSTEMS.filter((s) => s.igdbPlatforms.some((p) => ids.has(p)));
}

/** Every IGDB platform id Streamy can fetch for: the catalog search is limited to these. */
export const SUPPORTED_IGDB_PLATFORMS = [...new Set(GAME_SYSTEMS.flatMap((s) => s.igdbPlatforms))];
