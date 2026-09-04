/**
 * Background auto-matching for game artwork: gives every library game a
 * default cover/banner/logo/icon without anyone having to click through the
 * picker, while leaving the picker (and its pickedManually=true rows) as the
 * only thing that ever *overrides* an auto pick or reaches the Deck.
 *
 * Deliberately mirrors, in spirit, the matching mediabox-infra's
 * deck/steam_sync.py already does for the Deck's own automatic SGDB
 * gap-filling (same title-cleaning approach, same similarity-threshold
 * gate) -- not because the two need to agree pick-for-pick (they don't; two
 * independent implementations of "best guess" are allowed to guess
 * differently), but because that threshold is proven against this app's own
 * real bad-match cases (SpongeBob matching a 4-game compilation,
 * "DreamWorks Madagascar" matching an unrelated VR game) and there is no
 * reason to re-derive it from scratch.
 */

import { prisma } from "./db";
import { romSearchTitle } from "./romNames";
import {
  ARTWORK_KINDS,
  getArtworkCandidates,
  isSgdbConfigured,
  searchSgdbGames,
  type ArtworkKind,
} from "./steamgriddb";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Character-level ratio (via a simple LCS-based similarity) combined with
 * token-set overlap -- the same two-signal combination steam_sync.py uses
 * and for the same reason: character ratio alone misses "the query merely
 * appears inside a much longer title" (a compilation listing the game among
 * several), and token overlap alone misses reordering/punctuation noise.
 * Exported for testing.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
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

// Same value as steam_sync.py's SGDB_MIN_SIMILARITY, and for the same
// reason -- chosen against real observed misses ("DreamWorks Madagascar" vs
// an unrelated "DreamWorks Voltron VR Chronicles" scores ~0.5) and real
// hits (~0.86+). Below this, no art is picked rather than a wrong one --
// the game just falls back to the placeholder until someone manually picks.
const MIN_SIMILARITY = 0.72;

async function resolveSgdbGame(title: string): Promise<{ id: number; name: string } | null> {
  const cleaned = romSearchTitle(title);
  if (!cleaned) return null;
  const candidates = await searchSgdbGames(cleaned);
  let best: { id: number; name: string } | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = titleSimilarity(cleaned, c.name);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= MIN_SIMILARITY ? best : null;
}

/**
 * Fills in whichever of the four artwork kinds a game has no row for at
 * all yet (manual or auto) -- never touches a kind that already has one,
 * manual or otherwise, so a real human pick is never at risk of being
 * silently reconsidered by a later auto-match run.
 *
 * Best-effort throughout: SGDB being briefly unreachable, or genuinely
 * having no confident match for an obscure ROM, both just leave that game
 * on the placeholder for this pass -- never an error surfaced to whoever
 * triggered the run.
 */
export async function autoFillMissingArt(
  system: string,
  romStem: string,
  title: string
): Promise<{ filled: ArtworkKind[] }> {
  if (!isSgdbConfigured()) return { filled: [] };

  const existing = await prisma.gameArtwork.findMany({
    where: { system, romStem },
    select: { kind: true },
  });
  const have = new Set(existing.map((r) => r.kind));
  const missing = ARTWORK_KINDS.filter((k) => !have.has(k));
  if (missing.length === 0) return { filled: [] };

  const game = await resolveSgdbGame(title);
  if (!game) return { filled: [] };

  const filled: ArtworkKind[] = [];
  for (const kind of missing) {
    try {
      const candidates = await getArtworkCandidates(game.id, kind);
      const top = candidates[0];
      if (!top) continue;
      await prisma.gameArtwork.upsert({
        where: { system_romStem_kind: { system, romStem, kind } },
        create: {
          system,
          romStem,
          kind,
          imageUrl: top.url,
          sgdbGameId: game.id,
          title,
          pickedManually: false,
        },
        // Only reached if a race inserted the same row between the
        // findMany above and here -- update rather than error, but still
        // never touch pickedManually so a real pick that landed in that
        // gap wins over this pass regardless of ordering.
        update: {},
      });
      filled.push(kind);
    } catch (err) {
      console.error(`[gameArtworkAuto] ${kind} lookup failed for "${title}":`, err);
    }
  }
  return { filled };
}
