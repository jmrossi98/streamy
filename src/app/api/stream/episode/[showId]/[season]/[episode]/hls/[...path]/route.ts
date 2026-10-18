import { getSession, getValidSessionUserId } from "@/lib/auth";
import { streamEpisodeItemId, checkedEpisodeStream } from "@/lib/streamItemId";
import { proxyJellyfinHlsResource } from "@/lib/streamProxy";
import { chooseAudio, getLanguagePlan } from "@/lib/playbackLanguage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ showId: string; season: string; episode: string; path: string[] }> };

export async function GET(request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { showId, season, episode, path } = await params;
  const seasonNum = Number.parseInt(season, 10);
  const episodeNum = Number.parseInt(episode, 10);
  if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) {
    return new Response("Bad request", { status: 400 });
  }

  const itemId = await streamEpisodeItemId(showId, seasonNum, episodeNum);
  if (!itemId) {
    return new Response("Not available", { status: 404 });
  }

  const resource = path.join("/");
  // Only the master picks the audio track; Jellyfin carries it from there.
  const audio =
    resource === "master.m3u8"
      ? chooseAudio(await getLanguagePlan(itemId, "tv", showId), new URL(request.url).searchParams.get("audio"))
      : null;
  const res = await proxyJellyfinHlsResource(
    itemId,
    resource,
    `/api/stream/episode/${showId}/${seasonNum}/${episodeNum}/hls`,
    request,
    undefined,
    audio,
    false,
    { user: session?.user?.name ?? "unknown", kind: "episode", ref: itemId }
  );
  return checkedEpisodeStream(res, showId, seasonNum, episodeNum);
}
