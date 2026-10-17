import { getSession, getValidSessionUserId } from "@/lib/auth";
import { getEpisodePlayback } from "@/lib/episodePlayback";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ showId: string; season: string; episode: string }> };

// Everything the player needs for one episode -- what the standalone episode
// page renders with -- so the player can roll on to the next episode in place
// (keeping fullscreen) instead of navigating to that page.
export async function GET(request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { showId, season, episode } = await params;
  const seasonNum = Number.parseInt(season, 10);
  const episodeNum = Number.parseInt(episode, 10);
  if (Number.isNaN(seasonNum) || Number.isNaN(episodeNum)) return new Response("Bad request", { status: 400 });

  const found = await getEpisodePlayback(showId, seasonNum, episodeNum, {
    userId,
    userAgent: request.headers.get("user-agent"),
  });
  if (!found) return new Response("Not found", { status: 404 });
  return Response.json(found.playback, { headers: { "Cache-Control": "no-store" } });
}
