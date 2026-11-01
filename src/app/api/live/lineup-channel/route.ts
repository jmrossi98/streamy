import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { cleanChannelName } from "@/lib/liveChannelRules";
import { waitForLineupChannel } from "@/lib/liveTv";

/**
 * Jellyfin's id for a channel just added to the lineup, once Jellyfin lists
 * it: {jellyfinId}, null while it doesn't yet.
 *
 * The add route waits up to 15 s for the listing. A guide refresh can take
 * longer, and the game page then had nothing to play and nothing new in its
 * list until a reload (2026-11-01), so it asks here every few seconds instead.
 * Takes the stream's name and cleans it the way the channel was named.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const jellyfinId = await waitForLineupChannel(cleanChannelName(name), 2_500);
  return NextResponse.json({ jellyfinId });
}
