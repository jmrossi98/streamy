import { getSession, getValidSessionUserId } from "@/lib/auth";
import { streamMovieItemId } from "@/lib/streamItemId";
import { proxyJellyfinTrickplay } from "@/lib/streamProxy";

/** One sheet of a movie's seek bar thumbnails. */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ tmdbId: string; sheet: string }> };

export async function GET(request: Request, { params }: Props) {
  if (!(await getValidSessionUserId(await getSession()))) return new Response("Unauthorized", { status: 401 });
  const { tmdbId, sheet } = await params;
  const n = Number.parseInt(sheet, 10);
  if (Number.isNaN(n)) return new Response("Bad request", { status: 400 });
  const itemId = await streamMovieItemId(tmdbId);
  if (!itemId) return new Response("Not available", { status: 404 });
  return proxyJellyfinTrickplay(itemId, n, request);
}
