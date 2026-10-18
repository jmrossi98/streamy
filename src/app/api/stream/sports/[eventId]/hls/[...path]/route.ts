import { getSession, getValidSessionUserId } from "@/lib/auth";
import { checkedRecordingStream, streamRecordingItemId } from "@/lib/streamItemId";
import { proxyJellyfinHlsResource } from "@/lib/streamProxy";

/**
 * The transcode path for a game recording -- master playlist, variant and
 * segments -- rewritten so nothing points at Jellyfin directly (see
 * proxyJellyfinHlsResource). No audio-language plan here: a broadcast has one
 * commentary track, and Jellyfin's default is it.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ eventId: string; path: string[] }> };

export async function GET(request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { eventId: raw, path } = await params;
  const eventId = Number.parseInt(raw, 10);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return new Response("Bad request", { status: 400 });
  }

  const itemId = await streamRecordingItemId(eventId);
  if (!itemId) {
    return new Response("Not available", { status: 404 });
  }

  const res = await proxyJellyfinHlsResource(itemId, path.join("/"), `/api/stream/sports/${eventId}/hls`, request, undefined, undefined, false, {
    user: session?.user?.name ?? "unknown",
    kind: "recording",
    ref: itemId,
  });
  return checkedRecordingStream(res, eventId);
}
