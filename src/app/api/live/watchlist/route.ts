import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * My List for live TV channels.
 *
 * Stores a name snapshot alongside the id, unlike the movie/show lists.
 * Channels live in Jellyfin's tuner rather than in this database, and a
 * playlist-backed tuner churns its ids whenever the source updates -- so
 * without a snapshot a list entry for a vanished channel would render as a
 * bare identifier.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!channelId || !name) {
    return NextResponse.json({ error: "channelId and name required" }, { status: 400 });
  }

  await prisma.watchlistChannelItem.upsert({
    where: { userId_channelId: { userId, channelId } },
    create: { userId, channelId, name },
    // Refreshed on re-add, so a renamed channel doesn't keep an old label.
    update: { name },
  });
  return NextResponse.json({ added: true });
}

export async function DELETE(request: Request) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const channelId = new URL(request.url).searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  await prisma.watchlistChannelItem.deleteMany({ where: { userId, channelId } });
  return NextResponse.json({ removed: true });
}
