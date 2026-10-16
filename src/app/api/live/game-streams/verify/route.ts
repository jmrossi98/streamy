import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { isStreamProbeConfigured, probeStream } from "@/lib/streamProbe";
import { parseStreamId } from "@/lib/streamVerifyRules";

/**
 * Checks one candidate stream for the game page's "More streams for this
 * game" list: does it actually deliver video? (streamVerifyRules.ts has the
 * 2026-10-16 incident.) Signed-in only, like the list itself.
 *
 * The probe runs on mediabox, inside the VPN, and refuses rather than open a
 * stream on a provider someone is watching. Its answer is reduced to status,
 * rate and a short reason here -- never the stream URL, which carries the
 * provider login.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isStreamProbeConfigured()) {
    return NextResponse.json({ status: "error", reason: "the stream probe is not configured" });
  }
  const streamId = parseStreamId(new URL(request.url).searchParams.get("streamId"));
  if (streamId === null) return NextResponse.json({ error: "streamId must be a number" }, { status: 400 });
  return NextResponse.json(await probeStream(streamId));
}
