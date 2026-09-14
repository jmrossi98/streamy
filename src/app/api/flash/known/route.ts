import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { ensureKnownGame } from "@/lib/flashImport";
import { isPlayableHere, toFlashpointGame } from "@/lib/flashpoint";

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

  const body = (await request.json().catch(() => null)) as { game?: unknown } | null;
  // Re-validated rather than trusted: this arrives from the browser, which got
  // it from us, but that is not the same as it still being what we sent.
  const game = toFlashpointGame((body?.game ?? {}) as Record<string, unknown>);
  if (!game) return NextResponse.json({ error: "Invalid game" }, { status: 400 });
  if (!isPlayableHere(game)) {
    return NextResponse.json({ error: "Not a Flash game" }, { status: 400 });
  }

  const slug = await ensureKnownGame(game);
  return NextResponse.json({ slug });
}
