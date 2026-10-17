import { getSession, getValidSessionUserId } from "@/lib/auth";
import { findJellyfinEpisodeItemId, getJellyfinSegments } from "@/lib/jellyfin";
import { NO_SEGMENTS } from "@/lib/episodeSegmentRules";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ showId: string; season: string; episode: string }> };

// An episode's intro/recap/credits times, for the show page's overlay player,
// which (being a client component) learns them here rather than from the
// server render the standalone episode page has.
export async function GET(_request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { showId, season, episode } = await params;
  const seasonNum = Number.parseInt(season, 10);
  const episodeNum = Number.parseInt(episode, 10);
  if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) return new Response("Bad request", { status: 400 });

  const itemId = await findJellyfinEpisodeItemId(showId, seasonNum, episodeNum);
  return Response.json(itemId ? await getJellyfinSegments(itemId) : NO_SEGMENTS);
}
