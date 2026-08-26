import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkPasswordStrength } from "@/lib/passwordPolicy";
import { clientIpFromHeaders } from "@/lib/loginAttemptRules";
import { getLockoutState, recordLoginAttempt } from "@/lib/loginAttempts";

/**
 * Change your own password.
 *
 * There was previously no way to change a password at all -- the only route
 * under /api/profile was delete. That was awkward before and untenable now
 * that the admin account is a real privilege boundary.
 *
 * Three properties this needs beyond "write a new hash":
 *
 *  - The current password is required. A stolen *session* should not be enough
 *    to seize the account permanently; making the attacker prove they also know
 *    the password keeps a session theft recoverable by signing out.
 *  - It is rate limited, using the same counters as sign-in. Otherwise this
 *    becomes an oracle for guessing the current password that skips the login
 *    throttle entirely.
 *  - It stamps passwordChangedAt, which invalidates every session issued
 *    before now (see the jwt callback in lib/auth.ts).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Current and new password are both required." },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, password: true, approved: true, isAdmin: true },
  });
  // Approval is re-checked here for the same reason it is everywhere else:
  // a 30-day token can outlive the account's right to exist.
  if (!user?.approved) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const ip = clientIpFromHeaders(
    Object.fromEntries(request.headers) as Record<string, string | undefined>
  );

  const lock = await getLockoutState(user.name, ip);
  if (lock.lockedOut) {
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${lock.retryAfterMinutes} minute(s).` },
      { status: 429 }
    );
  }

  if (!(await bcrypt.compare(currentPassword, user.password))) {
    await recordLoginAttempt({ name: user.name, ip, outcome: "bad_password" });
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }

  // Admins are held to the longer minimum, matching account creation.
  const strength = checkPasswordStrength(newPassword, {
    isAdmin: user.isAdmin,
    name: user.name,
  });
  if (!strength.ok) {
    return NextResponse.json({ error: strength.reason }, { status: 400 });
  }

  if (await bcrypt.compare(newPassword, user.password)) {
    return NextResponse.json(
      { error: "New password must be different from the current one." },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await bcrypt.hash(newPassword, 10),
      passwordChangedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    // The caller signs out on this, because their own session is now stale too
    // -- invalidation deliberately does not exempt the device that made the
    // change, since we can't tell it apart from an attacker's.
    signOutRequired: true,
  });
}
