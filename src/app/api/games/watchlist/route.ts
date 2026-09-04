import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * My List for games, alongside /api/watchlist (movies/shows). Admin-gated
 * like every other games route -- the whole feature is admin-only, so this
 * is defense in depth against a guessed URL rather than the only thing
 * stopping a non-admin (the /games pages themselves already redirect).
 */

export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const userId = admin.id;

  const body = await request.json().catch(() => ({}));
  const gameKey = typeof body.gameKey === "string" ? body.gameKey.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const platform = typeof body.platform === "string" ? body.platform : "";
  if (!gameKey || !title) {
    return NextResponse.json({ error: "gameKey and title required" }, { status: 400 });
  }

  await prisma.watchlistGameItem.upsert({
    where: { userId_gameKey: { userId, gameKey } },
    create: { userId, gameKey, title, platform },
    update: { title, platform },
  });
  return NextResponse.json({ added: true });
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const userId = admin.id;

  const gameKey = new URL(request.url).searchParams.get("gameKey");
  if (!gameKey) {
    return NextResponse.json({ error: "gameKey required" }, { status: 400 });
  }
  await prisma.watchlistGameItem.deleteMany({ where: { userId, gameKey } });
  return NextResponse.json({ removed: true });
}
