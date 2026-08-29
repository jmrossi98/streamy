import { getSession, getValidSessionUserId } from "@/lib/auth";
import { findJellyfinMovieItemId } from "@/lib/jellyfin";
import { proxyJellyfinStream } from "@/lib/streamProxy";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ tmdbId: string }> };

export async function GET(request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { tmdbId } = await params;
  const itemId = await findJellyfinMovieItemId(tmdbId);
  if (!itemId) {
    return new Response("Not available", { status: 404 });
  }

  // The player retries with ?mode=transcode when direct-play fails on a codec
  // the browser can't handle (HEVC/10-bit/4K). ?t=<seconds> re-starts the
  // transcode from that position -- see the note on jellyfinTranscodeStreamUrl.
  const searchParams = new URL(request.url).searchParams;
  const transcode = searchParams.get("mode") === "transcode";
  const startSeconds = Number(searchParams.get("t"));
  return proxyJellyfinStream(itemId, request, {
    transcode,
    startSeconds: Number.isFinite(startSeconds) && startSeconds > 0 ? startSeconds : undefined,
  });
}
