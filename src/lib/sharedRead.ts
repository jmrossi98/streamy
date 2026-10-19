/**
 * One read shared by everyone asking for the same thing.
 *
 * The admin downloads panel re-renders every 2.5 seconds and each render asks
 * Sonarr for its queue, its wanted list and its routing. A request that takes
 * longer than that overlaps the next one, and one that times out at 15 seconds
 * has six more stacked behind it by then -- so Sonarr was asked hardest exactly
 * when it was least able to answer. On 2026-10-12, with 345 downloads queued
 * and Sonarr using two cores, half an hour held 68 routing, 51 wanted-list and
 * 44 queue timeouts, each of them work Sonarr still did.
 *
 * So: callers arriving while a read is in flight wait for that read; a fresh
 * answer is reused for its lifetime; and after a failure nothing is asked
 * again for a moment. While it is failing, the last good answer is served if
 * it is recent enough, which also stops rows vanishing from the panel for the
 * length of an outage.
 */

type Slot = { at: number; value: unknown; has: boolean; failedAt: number; inflight: Promise<unknown> | null };

const slots = new Map<string, Slot>();

/** After a failure, how long before the source is asked again. */
export const FAILURE_HOLD_MS = 10_000;
/** How old a last good answer may be and still stand in for a failed read. */
export const STALE_FOR_MS = 2 * 60_000;

type Options = {
  now?: () => number;
  /**
   * Once the answer is older than its TTL, hand it back at once and refresh
   * behind it rather than waiting on the source -- for a slow read whose
   * answer changes on the scale of minutes (a thousand history records, the
   * whole movie list). Capped by STALE_FOR_MS like the failure case.
   */
  serveStale?: boolean;
  /**
   * How long to leave the source alone after a failure. Longer for reads made
   * once per title: a library's worth of them failing together is a library's
   * worth of requests on every retry.
   */
  failureHoldMs?: number;
};

/**
 * @param ttlMs how long a good answer is reused. Rejects only when the read
 *              failed and there is no recent answer to fall back on.
 */
export async function sharedRead<T>(key: string, ttlMs: number, read: () => Promise<T>, options: Options = {}): Promise<T> {
  const now = options.now ?? (() => Date.now());
  const hold = options.failureHoldMs ?? FAILURE_HOLD_MS;
  let slot = slots.get(key);
  if (!slot) {
    slot = { at: 0, value: undefined, has: false, failedAt: 0, inflight: null };
    slots.set(key, slot);
  }
  const s = slot;
  if (s.has && now() - s.at < ttlMs) return s.value as T;
  const usable = () => s.has && now() - s.at < STALE_FOR_MS;
  if (s.inflight) return options.serveStale && usable() ? (s.value as T) : (s.inflight as Promise<T>);
  if (s.failedAt > 0 && now() - s.failedAt < hold) {
    if (usable()) return s.value as T;
    throw new Error(`${key}: failed a moment ago, not asked again yet`);
  }
  s.inflight = read()
    .then(
      (value) => {
        s.value = value;
        s.has = true;
        s.at = now();
        s.failedAt = 0;
        return value;
      },
      (err) => {
        s.failedAt = now();
        if (usable()) return s.value as T;
        throw err;
      }
    )
    .finally(() => {
      s.inflight = null;
    });
  if (options.serveStale && usable()) {
    // The refresh is on its way; its failure is handled on the next call.
    (s.inflight as Promise<T>).catch(() => {});
    return s.value as T;
  }
  return s.inflight as Promise<T>;
}

/** Drops a remembered answer, for when something is known to have changed it. */
export function forgetShared(key: string): void {
  const s = slots.get(key);
  if (s) {
    s.has = false;
    s.failedAt = 0;
  }
}

/**
 * Runs `work` over `items` a few at a time, keeping their order. For reads
 * made once per title, so a cold start asks a handful of questions at once
 * instead of one per movie in the library.
 */
export async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  }
  return out;
}
