import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Hidden channels for live TV -- the bulk-remove counterpart to My List.
 *
 * Stores a name snapshot alongside the id for the same reason
 * /api/live/watchlist does: channels live in Jellyfin's tuner rather than in
 * this database, and a playlist-backed tuner churns its ids whenever the
 * source updates.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Bulk-hide: {channels: [{channelId, name}]}. Single-channel hides just send a 1-item array. */
export async function POST(request: Request) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const channels = Array.isArray(body.channels) ? body.channels : [];
  const entries = channels
    .map((c: unknown) => {
      if (typeof c !== "object" || c === null) return null;
      const channelId = "channelId" in c && typeof c.channelId === "string" ? c.channelId.trim() : "";
      const name = "name" in c && typeof c.name === "string" ? c.name.trim() : "";
      return channelId && name ? { channelId, name } : null;
    })
    .filter((c: { channelId: string; name: string } | null): c is { channelId: string; name: string } => c !== null);

  if (entries.length === 0) {
    return NextResponse.json({ error: "channels required" }, { status: 400 });
  }

  await prisma.$transaction(
    entries.map((e: { channelId: string; name: string }) =>
      prisma.hiddenChannelItem.upsert({
        where: { userId_channelId: { userId, channelId: e.channelId } },
        create: { userId, channelId: e.channelId, name: e.name },
        update: { name: e.name },
      })
    )
  );
  return NextResponse.json({ hidden: entries.length });
}

export async function DELETE(request: Request) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const channelId = new URL(request.url).searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  await prisma.hiddenChannelItem.deleteMany({ where: { userId, channelId } });
  return NextResponse.json({ unhidden: true });
}
