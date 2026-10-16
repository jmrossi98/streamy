import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { getRecentGames, isSportarrConfigured } from "@/lib/sportarr";

/**
 * Finished games from the last few days with their recording status, for
 * the Live TV Sports tab. Signed-in, not admin-only: the same audience as
 * Live TV. Read-only -- nothing here searches or grabs (see
 * games/[eventId]/recording for both).
 *
 * Live and upcoming games are not here: the tab takes those from
 * /api/live/schedule, which has ESPN's clock and score.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSportarrConfigured()) {
    return NextResponse.json({ configured: false, games: [] });
  }
  try {
    const games = await getRecentGames();
    return NextResponse.json({ configured: true, games });
  } catch (err) {
    console.error("[sports/games] failed:", err);
    return NextResponse.json({ error: "Sportarr isn't responding" }, { status: 502 });
  }
}
