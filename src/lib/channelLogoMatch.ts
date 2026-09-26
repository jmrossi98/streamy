/**
 * Finding a usable logo for a channel that has none of its own.
 *
 * Pure, no imports, so the matching can be tested without a network.
 *
 * ## Why this is needed at all
 *
 * Every channel already has a logo recorded -- twenty-five of twenty-five
 * carry a `logo_id` in Dispatcharr. The pictures are simply not there:
 * measured 2026-09-26, one picon host answered HTTP 503 for everything and
 * another did not resolve, from Lightsail and from mediabox alike. Jellyfin
 * never managed to fetch those images, so it publishes no ImageTag, so the
 * card falls back to drawing the first four characters of the name in grey --
 * which is where "NFL", "SP -" and "USA" tiles come from.
 *
 * Caching fixes this going forward: a logo fetched once survives the host
 * going away. It cannot fix it backwards, because a logo we never held is not
 * in any cache. For the channels grey right now, borrowing is the only thing
 * that helps today.
 *
 * ## Why borrowing is safe here
 *
 * The provider ships the same network under several names -- "NBA TV" and
 * "SP - NBA TV HD", "NHL BUFFALO SABRES" and "US: SAN JOSE SHARKS" -- and
 * some of those rows have a working image while their siblings do not. A
 * channel's logo is a network's mark, not a per-feed asset, so showing NBA
 * TV's logo on the other NBA TV row is accurate rather than a guess.
 *
 * The risk to avoid is borrowing across networks: "SP - NHL NETWORK HD" must
 * not end up wearing the Sabres logo just because both say NHL. Matching is
 * therefore on the whole remaining name after decoration is stripped, never
 * on a shared word.
 */

/**
 * Leading market/category tags the provider prefixes onto names.
 *
 * Anchored and stripped only from the front: "US:" inside a name is part of
 * the name, and a channel genuinely called "NFL Network" should not lose its
 * first word.
 */
const PREFIXES = [
  /^us\s*:\s*/i,
  /^usa\s*-\s*/i,
  /^uk\s*:\s*/i,
  /^sp\s*-\s*/i,
  /^nfl\s*-\s*/i,
  /^nhl\s*-\s*/i,
  /^nba\s*-\s*/i,
  /^nba\s*:\s*/i,
  /^nhl\s*:\s*/i,
  /^nfl\s*:\s*/i,
];

/**
 * Quality and feed markers that say nothing about which network this is.
 *
 * Includes the superscript forms the provider uses (ᴴᴰ, ᴿᴬᵂ), which are single
 * codepoints rather than the ASCII letters they resemble, so they survive a
 * plain [a-z] filter and would otherwise stop two spellings of one channel
 * from matching.
 */
const SUFFIXES = [
  /\s*\bhd\b\s*$/i,
  /\s*\bsd\b\s*$/i,
  /\s*\bfhd\b\s*$/i,
  /\s*\braw\b\s*$/i,
  /\s*ᴴᴰ\s*$/u,
  /\s*ᴿᴬᵂ\s*$/u,
  /\s*\bus\b\s*$/i,
];

/**
 * The network a channel name refers to, with decoration removed.
 *
 * Returns "" when nothing is left, which happens for names that are only
 * decoration -- those must never match each other.
 */
export function networkKey(channelName: string): string {
  let s = channelName;
  // Repeatedly, because names carry several: "US: PEACOCK ORIGINAL 1 ᴿᴬᵂ".
  for (let i = 0; i < 4; i++) {
    const before = s;
    for (const p of PREFIXES) s = s.replace(p, "");
    for (const suf of SUFFIXES) s = s.replace(suf, "");
    s = s.trim();
    if (s === before) break;
  }
  // A bare league word with no separator -- "NHL SAN JOSE SHARKS" -- is also
  // a prefix, but stripping it unconditionally is not safe: "NFL - NFL
  // NETWORK" would collapse to "network", which then matches any other
  // network. Only strip when at least two words remain, which keeps team
  // names ("SAN JOSE SHARKS") while leaving one-word networks alone.
  const bare = s.match(/^(nfl|nhl|nba|mlb)\s+(.+)$/i);
  if (bare && bare[2].trim().split(/\s+/).length >= 2) {
    s = bare[2].trim();
  }

  // Parenthesised call signs are per-station, not per-network: "(WKBW)" and
  // "(WJZ)" would otherwise stop two feeds of one network from matching.
  s = s.replace(/\([^)]*\)/g, " ");
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type LogoCandidate = { name: string; logoUrl: string };

/**
 * A logo from a sibling channel of the same network, if one exists.
 *
 * Exact key equality only. A looser rule -- shared prefix, or one key
 * containing the other -- would let "nhlnetwork" match "nhlbuffalosabres",
 * putting a team badge on a network feed, which looks like a bug rather than
 * a fallback.
 *
 * Deterministic when several siblings qualify: the alphabetically first name
 * wins, so the same channel does not change logo between page loads.
 */
export function borrowLogo(
  channelName: string,
  candidates: LogoCandidate[]
): string | null {
  const key = networkKey(channelName);
  if (!key) return null;

  const matches = candidates
    .filter((c) => c.logoUrl && c.name !== channelName && networkKey(c.name) === key)
    .sort((a, b) => a.name.localeCompare(b.name));

  return matches[0]?.logoUrl ?? null;
}
