import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureKnownGame } from "@/lib/flashImport";
import {
  findById,
  isFamilyFriendly,
  isPlayableHere,
  toFlashpointGame,
} from "@/lib/flashpoint";

/**
 * Records an archive entry locally and returns its slug.
 *
 * Creates a catalogue row and nothing else -- no download. That is what makes
 * "add to My List" free from a 180,000-entry archive, and it is also what a
 * detail page needs before it can render anything.
 *
 * Idempotent on the Flashpoint id, so the same game arriving twice reuses its
 * row rather than accumulating near-duplicates.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { game?: unknown; id?: unknown }
    | null;

  // Two callers, two shapes. Search results arrive as a whole entry, because
  // the browser already has one. Catalogue shelves send only an id -- the
  // generated catalogue stores three fields per game rather than a full
  // metadata record each, so the rest is fetched here, once, at the moment
  // someone opens it.
  if (typeof body?.id === "string") {
    // Already known: answer from the database rather than paying an archive
    // round trip on every open of a game that has been opened before.
    const known = await prisma.flashGame.findUnique({
      where: { flashpointId: body.id },
      select: { slug: true },
    });
    if (known) return NextResponse.json({ slug: known.slug });
  }

  const game =
    typeof body?.id === "string"
      ? await findById(body.id)
      : // Re-validated rather than trusted: this arrives from the browser,
        // which got it from us, but that is not the same as it still being
        // what we sent.
        toFlashpointGame((body?.game ?? {}) as Record<string, unknown>);

  if (!game) return NextResponse.json({ error: "Invalid game" }, { status: 400 });
  if (!isPlayableHere(game)) {
    return NextResponse.json({ error: "Not a Flash game" }, { status: 400 });
  }
  if (!isFamilyFriendly(game)) {
    return NextResponse.json({ error: "Not available here" }, { status: 400 });
  }

  const slug = await ensureKnownGame(game);
  return NextResponse.json({ slug });
}
