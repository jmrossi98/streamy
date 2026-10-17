import { getSession, getValidSessionUserId } from "@/lib/auth";
import { streamMovieItemId } from "@/lib/streamItemId";
import { proxyJellyfinTrickplay } from "@/lib/streamProxy";

/** The seek bar's thumbnail manifest for a movie -- see trickplayRules.ts. */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ tmdbId: string }> };

export async function GET(request: Request, { params }: Props) {
  if (!(await getValidSessionUserId(await getSession()))) return new Response("Unauthorized", { status: 401 });
  const itemId = await streamMovieItemId((await params).tmdbId);
  if (!itemId) return new Response("Not available", { status: 404 });
  return proxyJellyfinTrickplay(itemId, null, request);
}
