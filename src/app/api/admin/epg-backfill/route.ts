import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { backfillChannelEpg, isDispatcharrConfigured } from "@/lib/dispatcharr";

/**
 * Gives EPG to already-promoted channels that have none.
 *
 * Admin only, and on demand rather than automatic. Promoting through Streamy
 * has mapped EPG at creation time since the tvg_id work, but that covers
 * nothing promoted before it, and nothing created directly in Dispatcharr's
 * own UI -- which is most of the current lineup. EPG is the only signal that
 * is a *fact* about which game is airing rather than a guess from a channel's
 * name, so a channel without it can never be confirmed for a fixture.
 *
 * Idempotent (see backfillChannelEpg), so re-running is safe and is the point:
 * it is the thing to press after adding channels outside Streamy.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!isDispatcharrConfigured()) {
    return NextResponse.json({ error: "Dispatcharr isn't configured on the server." }, { status: 503 });
  }

  const result = await backfillChannelEpg();
  if (!result) {
    return NextResponse.json({ error: "Couldn't reach Dispatcharr." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, ...result });
}
