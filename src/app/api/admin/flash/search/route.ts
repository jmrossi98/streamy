import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isPlayableHere, searchFlashpoint } from "@/lib/flashpoint";

/**
 * Searches Flashpoint Archive for a game to add.
 *
 * Admin-only: this is how the library gets curated, not how it gets browsed.
 *
 * Filtered to Flash. The archive also preserves Shockwave, Unity, Java and
 * HTML5 content, none of which Ruffle can play -- showing those would mean
 * offering results that cannot become a playable game here.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ results: [] });

  // searchFlashpoint never throws -- an unreachable archive is an empty
  // result, not a failed page.
  const results = (await searchFlashpoint(query, 40)).filter(isPlayableHere);
  return NextResponse.json({ results });
}
