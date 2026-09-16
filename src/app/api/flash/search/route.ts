import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { isPlayableHere, searchFlashpoint } from "@/lib/flashpoint";

/**
 * Searches Flashpoint Archive for a game to play.
 *
 * Signed-in, not admin: this is how anyone finds a game not already on one of
 * the curated shelves, the same audience as the shelves themselves. Replaces
 * the old admin-only search-and-display panel, which only ever showed a
 * result -- getting it onto the site still meant a separate manual step.
 * Clicking a result here goes straight through /api/flash/known, the same
 * click-to-play path the curated rows already use.
 *
 * Filtered to Flash. The archive also preserves Shockwave, Unity, Java and
 * HTML5 content, none of which Ruffle can play here.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ results: [] });

  // searchFlashpoint never throws -- an unreachable archive is an empty
  // result, not a failed page.
  const results = (await searchFlashpoint(query, 40)).filter(isPlayableHere);
  return NextResponse.json({ results });
}
