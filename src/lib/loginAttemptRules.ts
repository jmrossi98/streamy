/**
 * Brute-force policy, kept free of Prisma and next-auth so it can be tested
 * directly -- same split as downloadHealthRules.ts, and for the same reason:
 * importing the real module drags in the server stack.
 *
 * Context: the login endpoint had no throttling at all. It is public, it is
 * the only thing standing in front of the admin account, and until now an
 * attacker could guess passwords as fast as the box would answer.
 */

export const ATTEMPT_WINDOW_MINUTES = 15;
export const LOCKOUT_MINUTES = 15;

/** Per-account: how many wrong passwords before that name stops answering. */
export const MAX_FAILURES_PER_NAME = 5;

/**
 * Per-IP, across all names. Catches spraying -- one guess each against many
 * accounts never trips a per-account counter. Set well above the per-name
 * limit so a household behind one NAT address doesn't lock itself out.
 */
export const MAX_FAILURES_PER_IP = 20;

/**
 * Signing in with an unused name creates the account, which makes account
 * creation an unauthenticated write. These two cap it per source address.
 * The window is long because legitimate signups are rare here -- this is a
 * media server shared with friends, not a product with a growth funnel.
 */
export const SIGNUP_WINDOW_HOURS = 24;
export const MAX_SIGNUPS_PER_IP = 3;

export function signupWindowStart(now: Date): Date {
  return new Date(now.getTime() - SIGNUP_WINDOW_HOURS * 60 * 60_000);
}

export type LockoutInput = {
  /** Failures for this name inside the window. */
  nameFailures: number;
  /** Failures from this IP inside the window, across all names. */
  ipFailures: number;
  /** Most recent failure counted above, or null when there are none. */
  newestFailureAt: Date | null;
  now: Date;
};

export type LockoutState =
  | { lockedOut: false }
  | { lockedOut: true; scope: "name" | "ip"; retryAfterMinutes: number };

export function evaluateLockout(input: LockoutInput): LockoutState {
  const { nameFailures, ipFailures, newestFailureAt, now } = input;

  const scope: "name" | "ip" | null =
    nameFailures >= MAX_FAILURES_PER_NAME
      ? "name"
      : ipFailures >= MAX_FAILURES_PER_IP
        ? "ip"
        : null;

  if (!scope || !newestFailureAt) return { lockedOut: false };

  // The clock runs from the newest failure, so continuing to guess extends the
  // lockout rather than waiting it out under load.
  const elapsedMs = now.getTime() - newestFailureAt.getTime();
  const remainingMs = LOCKOUT_MINUTES * 60_000 - elapsedMs;
  if (remainingMs <= 0) return { lockedOut: false };

  return {
    lockedOut: true,
    scope,
    retryAfterMinutes: Math.max(1, Math.ceil(remainingMs / 60_000)),
  };
}

/**
 * The cutoff for "recent" failures. Anything older is ignored, so a handful of
 * genuine typos last week never counts toward a lockout today.
 */
export function attemptWindowStart(now: Date): Date {
  return new Date(now.getTime() - ATTEMPT_WINDOW_MINUTES * 60_000);
}

/**
 * Client IP for attempt records.
 *
 * Order matters. Behind Cloudflare, `cf-connecting-ip` is set by the edge and
 * cannot be forged by the client, so it wins. `x-forwarded-for` is attacker-
 * controlled when a request somehow arrives without a proxy in front, so it is
 * the last resort and only its first entry is used.
 */
export function clientIpFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  const pick = (v: string | string[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

  const cf = pick(headers["cf-connecting-ip"]);
  if (cf) return cf;

  const real = pick(headers["x-real-ip"]);
  if (real) return real;

  const fwd = pick(headers["x-forwarded-for"]);
  if (fwd) return fwd.split(",")[0].trim();

  return "unknown";
}
