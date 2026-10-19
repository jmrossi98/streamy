/**
 * In-process TTL cache with single-flight, for outbound calls that a render
 * asks for more often than the answer can change.
 *
 * The admin panel is the reason this exists. It fans out to roughly fifty
 * outbound calls per render (every health probe, both AWS Cost Explorer
 * queries, GitHub, disk, gamarr), and the downloads panel refreshes it on a
 * timer, so leaving the tab open meant re-asking every one of them every few
 * seconds forever. None of those answers move that fast; Cost Explorer bills
 * per request, so a few of them were being paid for.
 *
 * In-process and per-instance on purpose. Streamy runs as one Node server, so
 * a Map is the whole cache -- no Redis, and no unstable_cache, which these
 * can't use: they read env and the rendering path calls unstable_noStore().
 *
 * Single-flight matters as much as the TTL. Without it, a cold cache under
 * concurrent renders still sends N identical requests, which is how the
 * Dispatcharr token endpoint started answering 429.
 */

type Entry = { at: number; value: unknown };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

type Options<T> = {
  /**
   * Answers that shouldn't be held onto. A transient failure usually reads as
   * a null, and caching that turns one bad moment into a TTL-long outage.
   */
  skipCacheIf?: (value: T) => boolean;
  /**
   * Once the TTL is up, hand back the old answer at once and refresh behind
   * it, rather than making the caller wait for the source. For a read that
   * is slow and only slightly stale-sensitive: Sonarr's completed-episode
   * list takes six seconds under search load, and the downloads panel's
   * render was paying that every thirty seconds -- hitting its deadline and
   * drawing without TV rows -- for a list that changes on the scale of
   * minutes. A failed refresh keeps the old answer and is tried again on the
   * next call.
   */
  staleWhileRevalidate?: boolean;
};

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options: Options<T> = {}
): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return hit && options.staleWhileRevalidate ? (hit.value as T) : (pending as Promise<T>);

  // Rejections are never cached -- the catch below only cleans up, so the
  // next caller retries rather than inheriting a thrown error.
  const run = fn()
    .then((value) => {
      if (!options.skipCacheIf?.(value)) entries.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, run);
  if (hit && options.staleWhileRevalidate) {
    // The refresh is on its way; a rejection is nobody's to await here.
    run.catch(() => {});
    return hit.value as T;
  }
  return run;
}

/**
 * Drops cached answers so the next read goes to the source.
 *
 * With no argument, drops everything. Takes a prefix rather than an exact key
 * so a caller can clear a family ("aws") without naming each entry.
 */
export function invalidateCache(prefix?: string): void {
  if (prefix === undefined) {
    entries.clear();
    return;
  }
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}
