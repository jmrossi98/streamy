import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { staleChoiceCutoff } from "@/lib/gameChannelChoice";

/**
 * Remembering which channel someone picked for a game.
 *
 * The game page offers several plausible channels and plays the best guess
 * first. Switching away from that guess was a per-tab useState, so a reload
 * or a second device dropped the correction and re-tuned to the guess.
 *
 * Stores the name alongside the id, as /api/live/hidden does: the tuner
 * renumbers its channels on every playlist refresh, and the name is what is
 * left to match on afterwards.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Record a pick: {fixtureId, channelId, name}. */
export async function POST(request: Request) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const fixtureId = typeof body.fixtureId === "string" ? body.fixtureId.trim() : "";
  const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!fixtureId || !channelId || !name) {
    return NextResponse.json(
      { error: "fixtureId, channelId and name required" },
      { status: 400 }
    );
  }

  await prisma.gameChannelChoice.upsert({
    where: { userId_fixtureId: { userId, fixtureId } },
    create: { userId, fixtureId, channelId, name },
    update: { channelId, name, pickedAt: new Date() },
  });

  // Swept here rather than on a schedule, the same way the download healer
  // runs off page activity: a fixture is a day's business, so picks for games
  // finished a fortnight ago are dead weight and nobody needs a cron job to
  // say so. Scoped to this user, and failure is ignored -- a sweep that
  // didn't happen must never cost someone the pick they just made.
  try {
    await prisma.gameChannelChoice.deleteMany({
      where: { userId, pickedAt: { lt: staleChoiceCutoff() } },
    });
  } catch {
    // Non-fatal by design; the next pick tries again.
  }

  return NextResponse.json({ saved: true });
}

/** Forget a pick, so the page goes back to its own best match. */
export async function DELETE(request: Request) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const fixtureId = new URL(request.url).searchParams.get("fixtureId");
  if (!fixtureId) return NextResponse.json({ error: "fixtureId required" }, { status: 400 });

  await prisma.gameChannelChoice.deleteMany({ where: { userId, fixtureId } });
  return NextResponse.json({ cleared: true });
}
