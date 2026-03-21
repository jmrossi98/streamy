import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Delete a profile (User row). Cascades watchlist + progress.
 * - Signed in as that user: no name confirmation (Profile page).
 * - Not signed in: must send confirmName matching profile name (e.g. API clients).
 */
export async function POST(request: Request) {
  let body: { userId?: unknown; confirmName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const confirmName = typeof body.confirmName === "string" ? body.confirmName.trim() : "";

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const session = await getSession();
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const isSelf = session?.user?.id === userId;

  if (session?.user?.id && !isSelf) {
    return NextResponse.json(
      { error: "You can only remove your own profile while signed in." },
      { status: 403 }
    );
  }

  if (isSelf) {
    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ ok: true, deletedSelf: true });
  }

  if (!confirmName || user.name.trim().toLowerCase() !== confirmName.toLowerCase()) {
    return NextResponse.json(
      { error: "Profile name must match exactly to confirm deletion." },
      { status: 400 }
    );
  }

  await prisma.user.delete({ where: { id: userId } });
  return NextResponse.json({ ok: true });
}
