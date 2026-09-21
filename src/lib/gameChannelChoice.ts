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
