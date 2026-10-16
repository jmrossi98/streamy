import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { getLiveChannels, isJellyfinReachable } from "@/lib/liveTv";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { looksLikePlaceholder } from "@/lib/liveTimeline";
import { matchChannels, matchGames } from "@/lib/liveSearchRules";

/**
 * The live half of the header search: today's games and the channel lineup
 * (see liveSearchRules.ts). Separate from /api/search so a slow tuner or
 * schedule never holds up movie and show results. Signed-in only, like Live TV.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ games: [], channels: [] }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ games: [], channels: [] });

  const [fixtures, channels] = await Promise.all([
    getTodaysFixtures().catch(() => []),
    isJellyfinReachable()
      .then((ok) => (ok ? getLiveChannels() : []))
      .catch(() => []),
  ]);
  const games = matchGames(q, fixtures).map((g) => ({ id: g.id, name: g.name, league: g.league, detail: g.detail, state: g.state }));
  const lineup = channels
    .filter((c) => !looksLikePlaceholder(c.name))
    .map((c) => ({ id: c.id, name: c.name, number: c.number, nowName: c.now?.name ?? null, logoUrl: c.logoUrl }));
  return NextResponse.json({ games, channels: matchChannels(q, lineup) });
}
