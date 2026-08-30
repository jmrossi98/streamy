import { getSession, getValidSessionUserId } from "@/lib/auth";
import { stopJellyfinTranscode } from "@/lib/jellyfin";

export const dynamic = "force-dynamic";

/**
 * Kills the ffmpeg job behind one transcode session, called by the player
 * right before it asks for a new position in the same playback (a quality
 * switch to/within transcode, or a scrub-seek). See stopJellyfinTranscode for
 * why this has to happen explicitly: without it Jellyfin can keep the old
 * encode running and just keep serving that, ignoring the new position.
 */
export async function POST(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const playSessionId = typeof body?.playSessionId === "string" ? body.playSessionId : "";
  if (!playSessionId) {
    return new Response("playSessionId required", { status: 400 });
  }

  await stopJellyfinTranscode(playSessionId);
  return new Response(null, { status: 204 });
}
