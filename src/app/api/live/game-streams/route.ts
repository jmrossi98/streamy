import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { isDispatcharrConfigured, listPromotedStreamIds, listStreams } from "@/lib/dispatcharr";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { getAutomaticRenewals } from "@/lib/renewals";
import { providerAlert } from "@/lib/credentialRules";
import { gameStreamQueries, gameStreamScore, rankGameStreams } from "@/lib/gameStreamRules";
import { isStreamProbeConfigured } from "@/lib/streamProbe";
import { cached } from "@/lib/ttlCache";

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

  const [pages, promoted, renewals] = await Promise.all([
    // Cached per game for a few minutes: the search took 23s on 2026-10-18,
    // and the page asks again right after adding a feed (and for every other
    // viewer of the same game). Only a complete answer is kept.
    cached(
      `game-streams:${fixture.id}`,
      3 * 60_000,
      () => Promise.all(gameStreamQueries(fixture).map((q) => listStreams({ search: q, pageSize: 100 }).catch(() => null))),
      { skipCacheIf: (pages) => pages.some((p) => p === null) }
    ),
    listPromotedStreamIds().catch(() => null),
    getAutomaticRenewals().catch(() => []),
  ]);
  const expiredProviders = new Set(
    renewals.filter((r) => r.source === "iptv" && providerAlert(r)?.tone === "danger").map((r) => r.name.toLowerCase())
  );
  const streams = rankGameStreams(
    pages.flatMap((p) => p?.items ?? []),
    fixture,
    { promoted: new Set(promoted?.keys() ?? []), expiredProviders }
  );
  return NextResponse.json({
    streams: streams.map((s) => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      logoUrl: s.logoUrl,
      score: gameStreamScore(s.name, fixture),
    })),
    // Whether the page should check the top candidates with
    // /api/live/game-streams/verify. Off when the probe is not set up, which
    // leaves the list exactly as it was before checking existed.
    verify: isStreamProbeConfigured(),
  });
}
