/**
 * Memoised Jellyfin item ids for the progress routes, which now save every
 * 15s of playback: the movie lookup lists the whole library each call. Only
 * hits are cached -- a miss may be a download that hasn't landed yet.
 */
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { id: string; at: number }>();

export async function cachedItemId(key: string, lookup: () => Promise<string | null>): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.id;
  const id = await lookup();
  if (id) cache.set(key, { id, at: Date.now() });
  return id;
}
