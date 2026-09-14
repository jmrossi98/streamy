import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * My List for Flash games.
 *
 * Separate from /api/games/watchlist, which is the ROM one and is admin-gated
 * because that whole half of the tab is. Flash games are for the household, so
 * this is signed-in rather than admin -- and each user's list is their own.
 *
 * No title snapshot, unlike the ROM version: a Flash game's catalogue row
 * lives in this database, so there is nothing to preserve against the entry
 * disappearing. The relation cascades instead.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  // Checked rather than assumed: the foreign key would reject an unknown slug
  // anyway, but as a 500 rather than as the 404 it actually is.
  const game = await prisma.flashGame.findUnique({ where: { slug }, select: { slug: true } });
  if (!game) return NextResponse.json({ error: "No such game" }, { status: 404 });

  await prisma.watchlistFlashGameItem.upsert({
    where: { userId_slug: { userId, slug } },
    create: { userId, slug },
    update: {},
  });
  return NextResponse.json({ added: true });
}

export async function DELETE(request: Request) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  await prisma.watchlistFlashGameItem.deleteMany({ where: { userId, slug } });
  return NextResponse.json({ removed: true });
}
