import { getSession, getValidSessionUserId } from "@/lib/auth";
import { closeLiveStream } from "@/lib/liveTv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ends a live tune: stops the encode and releases the tuner.
 *
 * Called by LivePlayer when the viewer leaves a channel -- on unmount, and
 * again on pagehide for the tab-close case, which unmount never sees.
 *
 * Separate from /api/stream/stop, which exists for a different reason: that
 * one runs *mid-playback* so a VOD quality switch or scrub isn't served by a
 * stale encode. This one is the end of a viewing.
 *
 * Accepts a beacon-shaped request as well as a normal fetch. navigator.
 * sendBeacon is the only thing that reliably survives a tab closing, and it
 * sends text/plain with no way to override -- so the body is parsed as text
 * and then as JSON rather than trusting the content type.
 */
export async function POST(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const raw = await request.text().catch(() => "");
  let playSessionId = "";
  let mediaSourceId: string | undefined;
  try {
    const body = JSON.parse(raw) as { playSessionId?: unknown; mediaSourceId?: unknown };
    if (typeof body?.playSessionId === "string") playSessionId = body.playSessionId;
    if (typeof body?.mediaSourceId === "string") mediaSourceId = body.mediaSourceId;
  } catch {
    // Falls through to the 400 below.
  }

  if (!playSessionId) {
    return new Response("playSessionId required", { status: 400 });
  }

  await closeLiveStream(playSessionId, mediaSourceId);

  // 204 whatever Jellyfin made of it. The caller is a page being navigated
  // away from; there is nobody left to read a failure, and retrying a teardown
  // against a server that may already have cleaned up is not worth the round
  // trip.
  return new Response(null, { status: 204 });
}
