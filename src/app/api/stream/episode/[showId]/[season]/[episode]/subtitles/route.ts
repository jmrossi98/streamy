import { getSession, getValidSessionUserId } from "@/lib/auth";
import { findJellyfinEpisodeItemId, getJellyfinSubtitleTracks, needsForcedTranscode } from "@/lib/jellyfin";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ showId: string; season: string; episode: string }> };

// Lists an episode's subtitle tracks (plus whether it needs a forced
// transcode -- see needsForcedTranscode) for the overlay player in
// ShowContent, which is a client component and so can't reach
// lib/jellyfin.ts directly (server-only -- see its header comment). The
// watch page equivalent (show/[id]/episode/[season]/[episode]/page.tsx) is a
// server component and calls both functions itself instead of hitting this
// route.
export async function GET(_request: Request, { params }: Props) {
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
    return Response.json({ tracks: [], forceTranscode: false });
  }

  const [subtitles, forceTranscode] = await Promise.all([
    getJellyfinSubtitleTracks(itemId),
    needsForcedTranscode(itemId),
  ]);
  return Response.json({ tracks: subtitles?.tracks ?? [], forceTranscode });
}
