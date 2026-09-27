import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { refreshGuide } from "@/lib/liveTv";
import { demoteChannel, isDispatcharrConfigured } from "@/lib/dispatcharr";

/**
 * Removes a channel from the published lineup.
 *
 * Open to any signed-in viewer, matching search and promote.
 *
 * It was admin-only, on the reasoning that removing a channel interrupts
 * whoever is watching it rather than being a lineup change someone can shrug
 * off. That is still true, and it is why the audit entry below exists: the
 * action is shared and one-way, so it should at least say who did it.
 *
 * What makes it defensible to open up is that it is recoverable. The
 * underlying stream is untouched -- this demotes a channel back to an ordinary
 * catalogue entry, deletes nothing the provider owns, and the stream can be
 * promoted again from Browse all streams. A viewer who wants a channel gone
 * only from their own lineup wants Hide, which is per-viewer and sits beside
 * this in the UI.
 *
 * The removal does NOT disappear from Streamy immediately for the same
 * reason an addition doesn't appear immediately: Jellyfin caches its channel
 * list. Kicking a refresh here is the same mitigation promote already uses.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
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

  // After the fact, and only on success: an attempt that failed changed
  // nothing, and this is now the only record of who removed a channel
  // everybody shares.
  logAudit(session.user.name ?? "unknown", "liveTv.removeChannel", String(channelId));

  // Awaited, not fired and forgotten, so the response can say which of the
  // two things actually happened -- same reasoning as promote.
  const refreshing = await refreshGuide();

  return NextResponse.json({
    refreshing,
    note: refreshing
      ? "Removed. Jellyfin is refreshing its guide now - it disappears from Live TV in a moment."
      : "Removed from Dispatcharr, but Jellyfin didn't accept a refresh. It disappears on Jellyfin's next scheduled guide update.",
  });
}
