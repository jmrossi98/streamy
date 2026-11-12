import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { isDispatcharrConfigured } from "@/lib/dispatcharr";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { listGameStreamCandidates } from "@/lib/gameStreamCandidates";
import { isStreamProbeConfigured } from "@/lib/streamProbe";

/**
 * Provider streams that might carry one of today's games, for the game page's
 * "More streams for this game" list (see gameStreamRules.ts). Signed-in only,
 * like adding a stream. Read-only: adding one goes through
 * /api/live/streams/promote, the same as the stream browser.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDispatcharrConfigured()) return NextResponse.json({ streams: [] });
  const fixtureId = new URL(request.url).searchParams.get("fixtureId") ?? "";
  const fixture = (await getTodaysFixtures().catch(() => [])).find((f) => f.id === fixtureId);
  if (!fixture) return NextResponse.json({ streams: [] });

  return NextResponse.json({
    streams: await listGameStreamCandidates(fixture),
    // Whether the page should check the top candidates with
    // /api/live/game-streams/verify. Off when the probe is not set up, which
    // leaves the list exactly as it was before checking existed.
    verify: isStreamProbeConfigured(),
  });
}
