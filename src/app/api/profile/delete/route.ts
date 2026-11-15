import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canDeleteOwnProfile, OWN_PROFILE_REFUSALS } from "@/lib/accountDeletion";

/**
 * Delete your own profile (User row). Cascades watchlist + progress.
 *
 * Signed in, self only.
 *
 * This route used to accept an unauthenticated request carrying `confirmName`,
 * and deleted any account whose display name matched. The 403 guard above it
 * was gated on `session?.user?.id` being truthy, so an anonymous caller skipped
 * it entirely and fell through to the name branch. Display names are public --
 * /login lists them and is excluded from middleware, as is /api --
 * so anyone who could reach the site could delete any profile by name.
 *
 * The branch existed for "API clients" that never materialised: the only caller
 * is the signed-in self-delete on the Account page. Removing it costs nothing
 * and is the whole fix.
 *
 * The last admin is refused (canDeleteOwnProfile): an instance with no admin
 * cannot appoint one. The admin-side delete already refused it; this one
 * didn't until it moved from the navbar to the Account page (2026-11-15).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { userId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  if (userId !== session.user.id) {
    return NextResponse.json(
      { error: "You can only remove your own profile." },
      { status: 403 }
    );
  }

  const [self, adminCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
    prisma.user.count({ where: { isAdmin: true } }),
  ]);
  const verdict = canDeleteOwnProfile(self, adminCount);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: OWN_PROFILE_REFUSALS[verdict.reason] ?? "This profile can't be deleted." },
      { status: verdict.reason === "not-found" ? 404 : 409 }
    );
  }

  // deleteMany rather than delete: a stale session pointing at an already-
  // deleted row should report "not found", not throw a Prisma P2025.
  const result = await prisma.user.deleteMany({ where: { id: userId } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deletedSelf: true });
}
