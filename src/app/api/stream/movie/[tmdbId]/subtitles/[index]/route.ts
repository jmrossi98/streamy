import { getSession, getValidSessionUserId } from "@/lib/auth";
import { findJellyfinMovieItemId, getJellyfinSubtitleTracks } from "@/lib/jellyfin";
import { proxyJellyfinSubtitle } from "@/lib/streamProxy";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ tmdbId: string; index: string }> };

export async function GET(_request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { tmdbId, index } = await params;
  const trackIndex = Number.parseInt(index, 10);
  if (Number.isNaN(trackIndex)) {
    return new Response("Bad request", { status: 400 });
  }

  const itemId = await findJellyfinMovieItemId(tmdbId);
  if (!itemId) {
    return new Response("Not available", { status: 404 });
  }

  const subtitles = await getJellyfinSubtitleTracks(itemId);
  if (!subtitles || !subtitles.tracks.some((t) => t.index === trackIndex)) {
    return new Response("Not available", { status: 404 });
  }

  return proxyJellyfinSubtitle(itemId, subtitles.mediaSourceId, trackIndex);
}
