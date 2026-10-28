/**
 * Re-finding a remembered channel in a lineup that keeps moving.
 *
 * A stored pick is a channel id plus the name it had when it was picked.
 * Neither alone is reliable: a playlist-backed tuner renumbers its ids
 * whenever the source refreshes (the same reason HiddenChannelItem keeps a
 * name snapshot), and names are not unique across providers -- two "ESPN"
 * entries from different playlists are genuinely different streams.
 *
 * So: the id is the truth while it still exists, and the name is what's left
 * to go on once it doesn't. Pure, so it tests without a tuner or a database.
 */

/** How long a pick is worth keeping. Fixtures are a day's business. */
export const CHOICE_TTL_DAYS = 14;

export type StoredChoice = { channelId: string; name: string };

type Option = { id: string; name: string };

/**
 * The remembered option, or null to fall back to the page's own best match.
 *
 * Returns null rather than the first option on a miss: "we couldn't find what
 * you picked" and "here is our guess" are the same outcome, and the caller
 * already knows how to produce the guess.
 */
export function resolveStoredChoice<T extends Option>(
  options: T[],
  choice: StoredChoice | null
): T | null {
  if (!choice) return null;

  const byId = options.find((o) => o.id === choice.channelId);
  if (byId) return byId;

  // Fall back to the name, case-insensitively -- providers re-case their
  // listings ("ESPN HD" vs "ESPN Hd") as readily as they renumber them.
  const wanted = choice.name.trim().toLowerCase();
  if (!wanted) return null;
  return options.find((o) => o.name.trim().toLowerCase() === wanted) ?? null;
}

/** The cutoff for the opportunistic sweep of picks for games long finished. */
export function staleChoiceCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - CHOICE_TTL_DAYS * 86_400_000);
}

/**
 * Whether a feed the search just added automatically should take over the
 * player from what the viewer picked.
 *
 * A pick used to block every auto-switch. That is right when the pick is the
 * game itself -- a confirmed channel or another of the game's own feeds,
 * which the viewer chose over the rest -- and wrong when it is only a guess:
 * on 2026-10-27 (Sabres at Sharks) a viewer re-picked the 24/7 "NHL SAN JOSE
 * SHARKS" channel the page had started her on, and the real game feed the
 * search added later never reached her. A guess was picked because nothing
 * better existed yet; the found feed is the better thing.
 *
 * Never for a viewer's own add from the list (listed, not switched to), and
 * never for a feed that already failed to start this visit, so a feed that
 * falls over hands back to the fallback once rather than bouncing.
 */
export function foundFeedTakesOver({
  foundId,
  manual,
  pickedId,
  gameFeedIds,
  failedIds,
}: {
  /** The channel the search added. */
  foundId: string;
  /** Added by the viewer from the list rather than by the search. */
  manual: boolean;
  /** What the viewer picked (now or remembered from an earlier visit), or null. */
  pickedId: string | null;
  /** Every option known to carry the game: confirmed channels and the game's own feeds, including ones added this visit. */
  gameFeedIds: readonly string[];
  /** Channels that already failed to start this visit. */
  failedIds: readonly string[];
}): boolean {
  if (manual) return false;
  if (failedIds.includes(foundId)) return false;
  if (pickedId == null || pickedId === foundId) return true;
  return !gameFeedIds.includes(pickedId);
}
