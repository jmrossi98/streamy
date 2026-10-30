import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { getStream, isDispatcharrConfigured, listChannels } from "@/lib/dispatcharr";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { channelKey } from "@/lib/liveChannelStateRules";
import { feedStillNamesGame } from "@/lib/liveFailoverRules";

/**
 * Does the stream behind a game feed's channel still name the game?
 *
 * Asked by the game page right before it switches a viewer to a feed by
 * itself (a found feed taking over, a stalling feed handing over). trex's
 * playlist refresh renames streams in place, so a channel added for one game
 * can carry another hours later under its old name (feedStillNamesGame).
 *
 * Read-only and cheap: one channel list and one stream read from Dispatcharr,
 * no provider line touched. "unknown" whenever it can't tell -- the page
 * switches then, as it did before this check existed.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const fixtureId = params.get("fixtureId") ?? "";
  const channel = params.get("channel") ?? "";
  if (!fixtureId || !channel) return NextResponse.json({ error: "fixtureId and channel required" }, { status: 400 });
  if (!isDispatcharrConfigured()) return NextResponse.json({ verdict: "unknown" });

  const fixture = (await getTodaysFixtures().catch(() => [])).find((f) => f.id === fixtureId);
  if (!fixture) return NextResponse.json({ verdict: "unknown" });

  const channels = await listChannels().catch(() => null);
  const key = channelKey(channel);
  const row = channels?.find((c) => channelKey(c.name) === key);
  // The first stream is the one Dispatcharr plays.
  const streamId = row?.streamIds[0];
  if (streamId == null) return NextResponse.json({ verdict: "unknown" });
  const stream = await getStream(streamId).catch(() => null);
  if (!stream) return NextResponse.json({ verdict: "unknown" });

  return NextResponse.json({
    verdict: feedStillNamesGame(stream.name, fixture) ? "matches" : "renamed",
    streamName: stream.name,
  });
}
