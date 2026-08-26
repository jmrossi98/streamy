/**
 * Persistence for login attempts: the throttle in front of the login form, and
 * the evidence trail behind it.
 *
 * Two jobs, both previously missing:
 *   1. Rate limiting -- an unthrottled password field is a guessable one.
 *   2. Auth logging -- without a record, a brute-force attempt against this
 *      instance is invisible. The security monitor reads this table.
 *
 * Policy lives in loginAttemptRules.ts; only storage lives here.
 */

import { prisma } from "./db";
import {
  attemptWindowStart,
  evaluateLockout,
  signupWindowStart,
  type LockoutState,
} from "./loginAttemptRules";

/**
 * How long attempt rows are kept. Long enough for the security monitor (which
 * runs every 6 hours) to see a full picture, short enough that this table
 * never becomes a growth problem on a SQLite file.
 */
const RETENTION_DAYS = 30;

export type AttemptOutcome =
  | "success"
  | "signup"
  | "bad_password"
  | "unknown_user"
  | "not_approved"
  | "locked_out";

export async function recordLoginAttempt(input: {
  name: string;
  ip: string;
  outcome: AttemptOutcome;
}): Promise<void> {
  try {
    await prisma.loginAttempt.create({
      data: {
        name: input.name.slice(0, 200),
        ip: input.ip.slice(0, 100),
        success: input.outcome === "success",
        outcome: input.outcome,
      },
    });
  } catch (err) {
    // Never let bookkeeping break sign-in. A failure to log is worth a server
    // log line, not a locked-out user.
    console.error("[loginAttempts] failed to record attempt:", err);
  }
}

/** Current lockout for this name/IP pair, based on failures inside the window. */
export async function getLockoutState(name: string, ip: string): Promise<LockoutState> {
  const now = new Date();
  const since = attemptWindowStart(now);

  try {
    const [nameFailures, ipFailures, newest] = await Promise.all([
      prisma.loginAttempt.count({ where: { name, success: false, at: { gte: since } } }),
      prisma.loginAttempt.count({ where: { ip, success: false, at: { gte: since } } }),
      prisma.loginAttempt.findFirst({
        where: {
          success: false,
          at: { gte: since },
          OR: [{ name }, { ip }],
        },
        orderBy: { at: "desc" },
        select: { at: true },
      }),
    ]);

    return evaluateLockout({
      nameFailures,
      ipFailures,
      newestFailureAt: newest?.at ?? null,
      now,
    });
  } catch (err) {
    // Fail open. A database hiccup locking every user out of their own media
    // server is a worse outcome than a brief window without throttling, and
    // the attempt is still password-checked either way.
    console.error("[loginAttempts] lockout lookup failed, allowing attempt:", err);
    return { lockedOut: false };
  }
}

/** Accounts created from this address inside the signup window. */
export async function countRecentSignups(ip: string): Promise<number> {
  try {
    return await prisma.loginAttempt.count({
      where: { ip, outcome: "signup", at: { gte: signupWindowStart(new Date()) } },
    });
  } catch (err) {
    // Fail closed: if the counter can't be read we can't prove this address is
    // under its ceiling, and an unauthenticated write is the wrong thing to
    // wave through on a database error.
    console.error("[loginAttempts] signup count failed, treating as at-limit:", err);
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Called after a successful sign-in so a legitimate user who mistyped a few
 * times isn't left one typo away from a lockout for the rest of the window.
 * Only clears this name's failures -- the IP counter is deliberately left
 * alone, since spraying attempts from one address shouldn't be cleared by
 * happening to guess one account correctly.
 */
export async function clearFailuresForName(name: string): Promise<void> {
  try {
    await prisma.loginAttempt.deleteMany({ where: { name, success: false } });
  } catch (err) {
    console.error("[loginAttempts] failed to clear failures:", err);
  }
}

/** Drops rows past the retention window. Cheap; safe to call opportunistically. */
export async function pruneOldLoginAttempts(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    await prisma.loginAttempt.deleteMany({ where: { at: { lt: cutoff } } });
  } catch (err) {
    console.error("[loginAttempts] prune failed:", err);
  }
}
