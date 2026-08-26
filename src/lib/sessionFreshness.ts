/**
 * Whether a JWT predates the account's most recent password change.
 *
 * Sessions here are stateless 30-day tokens, so there is no server-side session
 * store to delete on a password change. Instead the token carries the stamp it
 * was minted with, and every request compares it to the stored one -- a change
 * moves the stored value, and every older token stops matching.
 *
 * Kept free of Prisma and next-auth so it tests directly, matching
 * downloadHealthRules.ts and loginAttemptRules.ts.
 */

/** Epoch ms for a password-change time. Null (never changed) is 0. */
export function passwordStamp(changedAt: Date | null | undefined): number {
  return changedAt?.getTime() ?? 0;
}

/**
 * Inequality rather than `token < stored` on purpose. A clock that moves
 * backwards, or a stamp restored from a backup, should still invalidate: any
 * disagreement means the token was not minted against the current password.
 */
export function isSessionStale(
  tokenStamp: number | undefined,
  changedAt: Date | null | undefined
): boolean {
  return (tokenStamp ?? 0) !== passwordStamp(changedAt);
}
