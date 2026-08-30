import { getSession, getValidSessionUserId } from "@/lib/auth";
import { findJellyfinEpisodeItemId, getJellyfinSubtitleTracks } from "@/lib/jellyfin";
import { proxyJellyfinSubtitle } from "@/lib/streamProxy";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ showId: string; season: string; episode: string; index: string }> };

export async function GET(_request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { showId, season, episode, index } = await params;
  const seasonNum = Number.parseInt(season, 10);
  const episodeNum = Number.parseInt(episode, 10);
  const trackIndex = Number.parseInt(index, 10);
  if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum) || Number.isNaN(trackIndex)) {
    return new Response("Bad request", { status: 400 });
  }

  const itemId = await findJellyfinEpisodeItemId(showId, seasonNum, episodeNum);
  if (!itemId) {
    return new Response("Not available", { status: 404 });
  }

  const subtitles = await getJellyfinSubtitleTracks(itemId);
  if (!subtitles || !subtitles.tracks.some((t) => t.index === trackIndex)) {
    return new Response("Not available", { status: 404 });
  }

  return proxyJellyfinSubtitle(itemId, subtitles.mediaSourceId, trackIndex);
}
