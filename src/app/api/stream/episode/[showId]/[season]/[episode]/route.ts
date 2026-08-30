import { getSession, getValidSessionUserId } from "@/lib/auth";
import { findJellyfinEpisodeItemId } from "@/lib/jellyfin";
import { proxyJellyfinStream } from "@/lib/streamProxy";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ showId: string; season: string; episode: string }> };

export async function GET(request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { showId, season, episode } = await params;
  const seasonNum = Number.parseInt(season, 10);
  const episodeNum = Number.parseInt(episode, 10);
  if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) {
    return new Response("Bad request", { status: 400 });
  }

  const itemId = await findJellyfinEpisodeItemId(showId, seasonNum, episodeNum);
  if (!itemId) {
    return new Response("Not available", { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const transcode = searchParams.get("mode") === "transcode";
  const startSeconds = Number(searchParams.get("t"));
  return proxyJellyfinStream(itemId, request, {
    transcode,
    startSeconds: Number.isFinite(startSeconds) && startSeconds > 0 ? startSeconds : undefined,
    playSessionId: searchParams.get("session") || undefined,
  });
}
