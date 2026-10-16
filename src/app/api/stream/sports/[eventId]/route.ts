import { getSession, getValidSessionUserId } from "@/lib/auth";
import { checkedRecordingStream, streamRecordingItemId } from "@/lib/streamItemId";
import { proxyJellyfinStream } from "@/lib/streamProxy";

/**
 * A game recording's bytes, proxied from Jellyfin exactly as an episode's
 * are (see ../../episode/...): the item is the file Sportarr imported under
 * /data/sports, found by path rather than by TMDB id.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const eventId = Number.parseInt((await params).eventId, 10);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return new Response("Bad request", { status: 400 });
  }

  const itemId = await streamRecordingItemId(eventId);
  if (!itemId) {
    return new Response("Not available", { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const transcode = searchParams.get("mode") === "transcode";
  const startSeconds = Number(searchParams.get("t"));
  const res = await proxyJellyfinStream(itemId, request, {
    transcode,
    startSeconds: Number.isFinite(startSeconds) && startSeconds > 0 ? startSeconds : undefined,
    playSessionId: searchParams.get("session") || undefined,
  });
  return checkedRecordingStream(res, eventId);
}
