import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { getLiveSchedule } from "@/lib/liveSchedule";

/**
 * Today's fixtures, for the Live TV "what's on" panel and the Sports tab.
 *
 * Signed-in, not admin-only -- this answers "what game is on", which is the
 * same audience as Live TV itself. Built and cached in lib/liveSchedule.ts,
 * which the Live TV page also reads so its "Live now" row arrives with the
 * page instead of after it.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { fixtures: await getLiveSchedule() },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
