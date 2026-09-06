import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/auditLog";

/**
 * Marks a library game for deletion.
 *
 * Records the intent rather than doing the removal: Streamy runs on a
 * different host from the ROM library with no filesystem access to it, and
 * gamarr has no delete endpoint. mediabox's own cron polls
 * /api/games/pending-deletions and does the real removal -- see GameDeletion
 * for why that pull direction was chosen over exposing a delete API.
 *
 * The game disappears from the UI immediately regardless, since getGamesList
 * filters out anything with a row here.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const system = typeof body.system === "string" ? body.system.trim() : "";
  const romStem = typeof body.romStem === "string" ? body.romStem.trim() : "";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : romStem;
  const undo = body.undo === true;

  if (!system || !romStem) {
    return NextResponse.json({ error: "system and romStem required" }, { status: 400 });
  }

  if (undo) {
    // Only meaningful while mediabox hasn't acted yet -- once deletedAt is
    // set the file is already gone and there's nothing to restore, so the
    // row stays and the game stays hidden.
    const existing = await prisma.gameDeletion.findUnique({
      where: { system_romStem: { system, romStem } },
    });
    if (existing?.deletedAt) {
      return NextResponse.json(
        { error: "Already deleted from disk -- can't undo" },
        { status: 409 }
      );
    }
    await prisma.gameDeletion.deleteMany({ where: { system, romStem } });
    logAudit(admin.name, "game.delete.undo", title, `${system}/${romStem}`);
    return NextResponse.json({ ok: true, undone: true });
  }

  await prisma.gameDeletion.upsert({
    where: { system_romStem: { system, romStem } },
    create: { system, romStem, title, requestedBy: admin.name },
    update: { title, requestedBy: admin.name },
  });
  logAudit(admin.name, "game.delete", title, `${system}/${romStem}`);
  return NextResponse.json({ ok: true });
}
