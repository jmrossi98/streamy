/**
 * Keeps Streamy under TMDB's rate limit.
 *
 * My List looks up every saved title at once. With ~500 saved movies (two
 * requests each) TMDB answered 339 of a burst with 429 Too Many Requests
 * (measured 2026-10-17), and those titles quietly vanished from the list.
 * So every TMDB request waits for one of a few slots, and a 429 or 5xx is
 * retried after the wait TMDB asks for.
 */

export const TMDB_MAX_IN_FLIGHT = 12;
export const TMDB_RETRIES = 4;

/** A failure worth retrying later, which must never be cached as "not found". */
export class TmdbTransientError extends Error {}

export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** How long to wait before retry `attempt` (0-based), honouring Retry-After. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const s = retryAfter != null ? Number(retryAfter) : NaN;
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 10_000);
  return Math.min(500 * 2 ** attempt, 8_000);
}

export function makeLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const limit = makeLimiter(TMDB_MAX_IN_FLIGHT);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() for TMDB: limited concurrency, retries on 429/5xx. Returns the last
 * response either way; a caller checks `isRetryable(res.status)` to tell a
 * refusal from a real "not found".
 */
export async function tmdbFetch(
  doFetch: () => Promise<Response>,
  { retries = TMDB_RETRIES, wait = sleep }: { retries?: number; wait?: (ms: number) => Promise<unknown> } = {}
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await limit(doFetch);
    if (!isRetryable(res.status) || attempt >= retries) return res;
    await wait(retryDelayMs(attempt, res.headers.get("retry-after")));
  }
}
