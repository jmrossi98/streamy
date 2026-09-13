import { getSession, getValidSessionUserId } from "@/lib/auth";
import { openLiveStream } from "@/lib/liveTv";
import { proxyJellyfinHlsResource } from "@/lib/streamProxy";

/**
 * HLS for a live channel.
 *
 * Same proxy as movies and episodes, for the same reasons (keeps the API key
 * server-side, and Jellyfin's own URLs point at a Tailscale-only HTTP address
 * a browser can't route to). Two things differ for live:
 *
 *   - the channel id *is* the item id, so there's no library lookup
 *   - a live stream has to be opened before it can be transcoded, and the
 *     transcode must name that stream's media source rather than the channel
 *
 * Only the master playlist opens a stream. The variant playlists and segments
 * that follow are references Jellyfin already emitted against the session the
 * master established, so re-tuning for each one would allocate a tuner per
 * segment -- which on a real HDHomeRun means exhausting the hardware in
 * seconds.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ channelId: string; path: string[] }> };

export async function GET(request: Request, { params }: Props) {
  const session = await getSession();
  if (!(await getValidSessionUserId(session))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { channelId, path } = await params;
  const jellyfinPath = path.join("/");
  const isMaster = jellyfinPath === "master.m3u8";

  let mediaSourceId: string | undefined;
  if (isMaster) {
    const handle = await openLiveStream(channelId);
    if (!handle) {
      // Ordinary, not exceptional: the tuner is busy, the upstream is down, or
      // the playlist entry is dead. 503 so the player can say "unavailable"
      // rather than treating it as a broken page.
      return new Response("Channel unavailable", { status: 503 });
    }
    mediaSourceId = handle.mediaSourceId;
  }

  return proxyJellyfinHlsResource(
    channelId,
    jellyfinPath,
    `/api/stream/live/${encodeURIComponent(channelId)}/hls`,
    request,
    mediaSourceId
  );
}
