import { getSession, getValidSessionUserId } from "@/lib/auth";
import { streamEpisodeItemId } from "@/lib/streamItemId";
import { proxyJellyfinTrickplay } from "@/lib/streamProxy";

/** One sheet of an episode's seek bar thumbnails. */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ showId: string; season: string; episode: string; sheet: string }> };

export async function GET(request: Request, { params }: Props) {
  if (!(await getValidSessionUserId(await getSession()))) return new Response("Unauthorized", { status: 401 });
  const { showId, season, episode, sheet } = await params;
  const s = Number.parseInt(season, 10);
  const e = Number.parseInt(episode, 10);
  const n = Number.parseInt(sheet, 10);
  if (Number.isNaN(s) || Number.isNaN(e) || Number.isNaN(n)) return new Response("Bad request", { status: 400 });
  const itemId = await streamEpisodeItemId(showId, s, e);
  if (!itemId) return new Response("Not available", { status: 404 });
  return proxyJellyfinTrickplay(itemId, n, request);
}
