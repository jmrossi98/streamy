/**
 * Resolves a fallback if a promise has not settled in time.
 *
 * The admin downloads panels gather from Radarr, Sonarr and gamarr in one
 * wave, so the page takes as long as the slowest of them. That was fine until
 * Sonarr got busy: a search-loaded Sonarr answers /api/v3/history (2 MB) so
 * slowly that the request hit its timeout, and the whole render sat waiting.
 * The browser gave up first -- "the destination stream closed early" -- so the
 * page showed nothing at all, including the rows that had been ready in
 * milliseconds, and the refresh button appeared to hang.
 *
 * A late answer is worth less than a fast partial one here. Every caller
 * already degrades gracefully to an empty list, so this makes "slow" behave
 * like the "unavailable" case they were written for.
 *
 * The underlying promise is not cancelled -- fetch is already bounded by its
 * own timeout, and letting it finish means its cache is warm for the next
 * render rather than starting over.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  fallback: T,
  ms: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([
      // A rejection is the same outcome as being slow: nothing to show.
      work.catch(() => fallback),
      expired,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
