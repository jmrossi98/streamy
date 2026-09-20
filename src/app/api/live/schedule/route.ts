import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { getMappedChannelPrograms } from "@/lib/dispatcharr";
import { matchFixturesToEpgProgrammes } from "@/lib/liveTimeline";

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

  // Best effort, and never lets a Dispatcharr hiccup take the whole schedule
  // down with it: this endpoint's job is the schedule, which ESPN alone
  // already answers -- EPG confirmation only ever adds a channel name, and
  // an empty result here just means none of today's fixtures get one.
  let epgConfirmedByFixtureId = new Map<string, string[]>();
  try {
    const programs = await getMappedChannelPrograms();
    if (programs) epgConfirmedByFixtureId = matchFixturesToEpgProgrammes(fixtures, programs);
  } catch (err) {
    console.error("[live/schedule] EPG match failed:", err);
  }

  const withEpg = fixtures.map((f) => ({
    ...f,
    epgConfirmedChannelNames: epgConfirmedByFixtureId.get(f.id) ?? [],
  }));

  return NextResponse.json(
    { fixtures: withEpg },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
