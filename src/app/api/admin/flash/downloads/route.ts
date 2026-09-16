import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteGameFile } from "@/lib/flashImport";

/**
 * The downloaded Flash games, and the ability to throw one away.
 *
 * Admin-only, unlike importing: fetching a game is what pressing play does,
 * but deleting one takes it away from everybody, so it is a maintenance
 * action rather than an ordinary one.
 *
 * Deleting clears the file and leaves the catalogue row -- see deleteGameFile.
 * The row is what My List entries and saved games point at, so removing it
 * would quietly take those with it.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const games = await prisma.flashGame.findMany({
    where: { fileName: { not: null } },
    select: { slug: true, title: true, fileName: true, fileSize: true, storage: true },
    orderBy: { title: "asc" },
  });
  return NextResponse.json({ games });
}

export async function DELETE(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const result = await deleteGameFile(slug);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
