import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/auditLog";
import { canDeleteAccount, REFUSAL_MESSAGES } from "@/lib/accountDeletion";

/**
 * Deletes a full account, with everything it owns.
 *
 * Separate from the approvals route, which also deletes a row: that one denies
 * a signup that has never been approved and owns nothing. This destroys a real
 * person's watch history, watchlists, progress and saves via the schema's
 * cascades, and is not recoverable -- hence the typed-name confirmation and
 * the rules in lib/accountDeletion.ts.
 *
 * Note it does not touch Jellyfin. Streamy holds no link to a Jellyfin user,
 * so there is nothing here that could reliably find the matching account, and
 * deleting the wrong one would be worse than deleting none. The panel says so.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const confirmName = typeof body?.confirmName === "string" ? body.confirmName : "";
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const [target, adminCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, isAdmin: true },
    }),
    prisma.user.count({ where: { isAdmin: true } }),
  ]);

  const verdict = canDeleteAccount(admin.id, target, adminCount, confirmName);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: REFUSAL_MESSAGES[verdict.reason] },
      // Not-found is the only one of these that isn't the admin being stopped
      // on purpose.
      { status: verdict.reason === "not-found" ? 404 : 400 }
    );
  }

  // Non-null past the verdict: canDeleteAccount returns "not-found" for null.
  const name = target!.name;

  // deleteMany scoped by id rather than delete: two admins acting at once
  // should leave the second with a no-op, not an exception.
  const result = await prisma.user.deleteMany({ where: { id: userId } });
  if (result.count === 0) {
    return NextResponse.json({ error: REFUSAL_MESSAGES["not-found"] }, { status: 404 });
  }

  // Logged after the fact with the name captured beforehand -- the row that
  // held it is gone, so this entry is the only remaining record that the
  // account ever existed.
  logAudit(admin.name, "account.delete", name);
  return NextResponse.json({ ok: true });
}
