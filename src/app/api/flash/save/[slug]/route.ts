import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * A viewer's save data for one Flash game.
 *
 * Flash games save through SharedObject, which Ruffle implements on top of
 * localStorage -- per device, per browser, and gone with a routine cache
 * clear. Playing inside Streamy is supposed to mean a save made on the TV is
 * there on a laptop, so the browser copy is a cache and this is the real one.
 *
 * The payload is stored whole and never parsed. Ruffle has no public API for
 * exporting SharedObjects (ruffle-rs/ruffle#22409 is the open request) and its
 * key format is not a stable contract, so anything here that tried to
 * understand the contents would break the first time it changed.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ceiling on one game's save.
 *
 * Flash's own SharedObject default was 100KB per domain and games were built
 * against it, so a legitimate save is far below this. The cap exists because
 * this endpoint accepts a blob from the browser -- it bounds what a bug or a
 * crafted request can push into the database, not what a real game needs.
 */
const MAX_SAVE_BYTES = 512 * 1024;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slug } = await params;
  const row = await prisma.flashGameSave.findUnique({
    where: { userId_slug: { userId, slug } },
    select: { data: true, updatedAt: true },
  });

  // No save is the normal first-play case, not an error.
  if (!row) return NextResponse.json({ data: null });

  try {
    return NextResponse.json({ data: JSON.parse(row.data), updatedAt: row.updatedAt });
  } catch {
    // Unparseable means something wrote nonsense; returning null makes the
    // game start fresh rather than refusing to load at all.
    return NextResponse.json({ data: null });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slug } = await params;

  const body = (await request.json().catch(() => null)) as { data?: unknown } | null;
  const data = body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "data must be an object" }, { status: 400 });
  }

  const serialized = JSON.stringify(data);
  if (serialized.length > MAX_SAVE_BYTES) {
    return NextResponse.json({ error: "Save too large" }, { status: 413 });
  }
  // An empty object would wipe a real save on a device where the game never
  // got far enough to write one -- refuse rather than overwrite.
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ saved: false, reason: "empty" });
  }

  const game = await prisma.flashGame.findUnique({ where: { slug }, select: { slug: true } });
  if (!game) return NextResponse.json({ error: "No such game" }, { status: 404 });

  await prisma.flashGameSave.upsert({
    where: { userId_slug: { userId, slug } },
    create: { userId, slug, data: serialized },
    update: { data: serialized },
  });
  return NextResponse.json({ saved: true });
}
