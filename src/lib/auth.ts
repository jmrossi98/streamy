import { cache } from "react";
import type { NextAuthOptions } from "next-auth";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { pickNextAvatarColor } from "./userAvatarColors";
import { checkPasswordStrength } from "./passwordPolicy";
import { isSessionStale, passwordStamp } from "./sessionFreshness";
import { clientIpFromHeaders, MAX_SIGNUPS_PER_IP } from "./loginAttemptRules";
import {
  clearFailuresForName,
  countRecentSignups,
  getLockoutState,
  pruneOldLoginAttempts,
  recordLoginAttempt,
} from "./loginAttempts";

/** Cached per request so multiple callers in the same render share one session fetch. */
export const getSession = cache(() => getServerSession(authOptions));

/**
 * Grants the admin role to ADMIN_NAME, but only while no admin exists.
 *
 * ADMIN_NAME is a bootstrap, not an authorization rule. If it stayed one,
 * anyone who could set that variable could point it at their own account and
 * take over; gating on "no admin yet" means it can claim the role exactly once,
 * and only into a vacuum. After that the database owns the answer.
 *
 * Returns whether the user ends up an admin.
 */
async function bootstrapAdminIfUnclaimed(user: {
  id: string;
  name: string;
  isAdmin: boolean;
}): Promise<boolean> {
  if (user.isAdmin) return true;

  const adminName = process.env.ADMIN_NAME?.trim();
  // An unset ADMIN_NAME must never match. Comparing an empty/undefined env var
  // against an empty/undefined name would otherwise hand out the role.
  if (!adminName || user.name !== adminName) return false;

  const existingAdmins = await prisma.user.count({ where: { isAdmin: true } });
  if (existingAdmins > 0) return false;

  await prisma.user.update({
    where: { id: user.id },
    data: { isAdmin: true, approved: true },
  });
  console.warn(`[auth] admin role bootstrapped for "${user.name}" (no admin existed)`);
  return true;
}

export const authOptions: NextAuthOptions = {
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        name: { label: "Name", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const name = credentials?.name?.trim();
        const password = credentials?.password ?? "";
        if (!name || !password) {
          throw new Error("Name and password are required.");
        }

        const ip = clientIpFromHeaders(
          (req?.headers ?? {}) as Record<string, string | string[] | undefined>
        );

        // Opportunistic and unawaited: retention housekeeping must not add
        // latency to a sign-in.
        void pruneOldLoginAttempts();

        const lock = await getLockoutState(name, ip);
        if (lock.lockedOut) {
          // Recorded, so a sustained attack is visible in the log rather than
          // silently bouncing off the lockout.
          await recordLoginAttempt({ name, ip, outcome: "locked_out" });
          throw new Error(
            `Too many failed attempts. Try again in ${lock.retryAfterMinutes} minute(s).`
          );
        }

        const existing = await prisma.user.findUnique({
          where: { name },
          select: {
            id: true,
            name: true,
            avatarColor: true,
            password: true,
            approved: true,
            isAdmin: true,
          },
        });

        if (!existing) {
          // Signing in with an unused name creates the account. That makes this
          // an unauthenticated write, so it needs its own ceiling -- otherwise
          // one script can fill the user table with pending rows.
          const recentSignups = await countRecentSignups(ip);
          if (recentSignups >= MAX_SIGNUPS_PER_IP) {
            await recordLoginAttempt({ name, ip, outcome: "locked_out" });
            throw new Error("Too many new accounts from this connection. Try again later.");
          }

          const adminName = process.env.ADMIN_NAME?.trim();
          const noAdminYet = (await prisma.user.count({ where: { isAdmin: true } })) === 0;
          const claimsAdmin = !!adminName && name === adminName && noAdminYet;

          const strength = checkPasswordStrength(password, { isAdmin: claimsAdmin, name });
          if (!strength.ok) {
            throw new Error(strength.reason);
          }

          const hashed = await bcrypt.hash(password, 10);
          const avatarColor = await pickNextAvatarColor();

          let user;
          try {
            user = await prisma.user.create({
              data: {
                name,
                password: hashed,
                approved: claimsAdmin,
                isAdmin: claimsAdmin,
                avatarColor,
              },
            });
          } catch {
            // Unique constraint: someone claimed this name between the lookup
            // and the insert. Previously there was no constraint, so this race
            // created two accounts with one name -- and if that name was the
            // admin's, two admins.
            throw new Error("That name was just taken. Try signing in again.");
          }

          await recordLoginAttempt({ name, ip, outcome: "signup" });

          if (!claimsAdmin) {
            throw new Error("Your account is pending approval.");
          }
          console.warn(`[auth] admin account "${name}" created (no admin existed)`);
          return { id: user.id, name: user.name, avatarColor: user.avatarColor };
        }

        const valid = await bcrypt.compare(password, existing.password);
        if (!valid) {
          await recordLoginAttempt({ name, ip, outcome: "bad_password" });
          throw new Error("Incorrect password.");
        }
        if (!existing.approved) {
          await recordLoginAttempt({ name, ip, outcome: "not_approved" });
          throw new Error("Your account is pending approval.");
        }

        await recordLoginAttempt({ name, ip, outcome: "success" });
        // Clears this name's failures so a legitimate user who mistyped twice
        // isn't left one typo from a lockout for the rest of the window.
        await clearFailuresForName(name);
        await bootstrapAdminIfUnclaimed(existing);

        return { id: existing.id, name: existing.name, avatarColor: existing.avatarColor };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name ?? undefined;
        token.avatarColor = (user as { avatarColor?: string | null }).avatarColor ?? undefined;
      }

      // Display hint only -- never an authorization decision.
      //
      // This used to be `token.name === process.env.ADMIN_NAME`, which meant
      // the JWT itself decided who was an admin and the database had no say.
      // It is now read from the User row, and every actual admin surface calls
      // requireAdmin(), which re-reads it per request. A stale value here can
      // at worst show someone an admin link that then refuses to load.
      if (token.id) {
        try {
          const row = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { isAdmin: true, passwordChangedAt: true },
          });
          token.isAdmin = row?.isAdmin ?? false;

          // Session invalidation on password change. Tokens are stateless and
          // last 30 days, so without this a password rotation would leave every
          // existing session working -- including one an attacker is holding,
          // which is the main reason anyone rotates in a hurry.
          if (user) {
            // Fresh sign-in: adopt the current stamp.
            token.pwAt = passwordStamp(row?.passwordChangedAt);
          } else if (isSessionStale(token.pwAt, row?.passwordChangedAt)) {
            // Issued before the most recent password change. Returning an empty
            // token strips the id, which is what every downstream check keys
            // off (middleware, getValidSessionUserId, requireAdmin).
            return {};
          }
        } catch {
          // A lookup failure must not silently promote anyone.
          token.isAdmin = false;
        }
      } else {
        token.isAdmin = false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
        session.user.avatarColor = token.avatarColor as string | undefined;
        session.user.isAdmin = token.isAdmin as boolean;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};

/**
 * JWT sessions can outlive the User row (db reset, switched DATABASE_URL, deleted user).
 * Use before Prisma writes that reference `userId` to avoid P2003 foreign key errors.
 *
 * Approval is re-checked here, not just at login. Sessions are JWTs valid for
 * 30 days, so checking only at sign-in meant revoking someone's approval left
 * them with up to a month of continued access -- deleting the account cut them
 * off, but un-approving them did nothing. Every call site that gates on a real
 * user now also gates on that user still being allowed in.
 */
export async function getValidSessionUserId(session: Session | null): Promise<string | null> {
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, approved: true },
  });
  if (!user?.approved) return null;
  return user.id;
}

/**
 * The only correct way to authorize an admin action.
 *
 * Admin surfaces previously trusted `session.user.isAdmin`, a value carried in
 * a 30-day JWT and derived from an environment variable. Nothing in the
 * database could revoke it: an admin who was deleted, un-approved, or demoted
 * kept full admin access until their token expired.
 *
 * This re-reads the row every call and requires both flags -- an un-approved
 * admin is not an admin. Returns null when the caller isn't one, so callers
 * decide between redirecting and returning 403.
 */
export async function requireAdmin(
  session: Session | null
): Promise<{ id: string; name: string } | null> {
  if (!session?.user?.id) return null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, approved: true, isAdmin: true },
    });
    if (!user?.approved || !user.isAdmin) return null;
    return { id: user.id, name: user.name };
  } catch (err) {
    // Fail closed. An unreachable database is a reason to deny an admin
    // action, never to allow one.
    console.error("[auth] admin check failed, denying:", err);
    return null;
  }
}

declare module "next-auth" {
  interface Session {
    user: { id: string; name: string; avatarColor?: string | null; isAdmin?: boolean };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    name?: string;
    avatarColor?: string;
    isAdmin?: boolean;
    /** User.passwordChangedAt as epoch ms at sign-in; 0 when never changed. */
    pwAt?: number;
  }
}
