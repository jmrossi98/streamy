import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { refreshGuide } from "@/lib/liveTv";
import { demoteChannel, isDispatcharrConfigured } from "@/lib/dispatcharr";

/**
 * Removes a channel from the published lineup.
 *
 * Admin only, and for the same reason promoting is: a channel removed here
 * disappears for every viewer, and it also makes Jellyfin re-enumerate its
 * tuner. The underlying stream is untouched -- this demotes a channel back to
 * an ordinary catalogue entry, it does not delete anything the provider owns,
 * and the stream is promotable again later from Browse all streams.
 *
 * The removal does NOT disappear from Streamy immediately for the same
 * reason an addition doesn't appear immediately: Jellyfin caches its channel
 * list. Kicking a refresh here is the same mitigation promote already uses.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!isDispatcharrConfigured()) {
    return NextResponse.json(
      { error: "Dispatcharr isn't configured on the server." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const channelId = Number(body?.channelId);
  if (!Number.isInteger(channelId) || channelId <= 0) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }

  const removed = await demoteChannel(channelId);
  if (!removed) {
    return NextResponse.json(
      { error: "Dispatcharr wouldn't remove that channel." },
      { status: 502 }
    );
  }

  // Awaited, not fired and forgotten, so the response can say which of the
  // two things actually happened -- same reasoning as promote.
  const refreshing = await refreshGuide();

  return NextResponse.json({
    refreshing,
    note: refreshing
      ? "Removed. Jellyfin is refreshing its guide now — it disappears from Live TV in a moment."
      : "Removed from Dispatcharr, but Jellyfin didn't accept a refresh. It disappears on Jellyfin's next scheduled guide update.",
  });
}
