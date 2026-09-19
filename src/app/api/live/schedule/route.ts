import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { getTodaysFixtures } from "@/lib/sportsSchedule";

/**
 * Today's fixtures, for the Live TV "what's on" panel.
 *
 * Signed-in, not admin-only -- this answers "what game is on", which is the
 * same audience as Live TV itself. Nothing here touches Dispatcharr or
 * Jellyfin; it is read-only against a public third-party API.
 *
 * Revalidated rather than force-dynamic with unstable_noStore: a schedule is
 * legitimately the same answer for 60 seconds, and ESPN is a third party this
 * app does not want ten viewers hitting independently on every page load.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fixtures = await getTodaysFixtures();
  return NextResponse.json(
    { fixtures },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
