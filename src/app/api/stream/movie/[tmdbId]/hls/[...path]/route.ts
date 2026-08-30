import { getSession, getValidSessionUserId } from "@/lib/auth";
import { findJellyfinMovieItemId } from "@/lib/jellyfin";
import { proxyJellyfinHlsResource } from "@/lib/streamProxy";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ tmdbId: string; path: string[] }> };

export async function GET(request: Request, { params }: Props) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { tmdbId, path } = await params;
  const itemId = await findJellyfinMovieItemId(tmdbId);
  if (!itemId) {
    return new Response("Not available", { status: 404 });
  }

  return proxyJellyfinHlsResource(itemId, path.join("/"), `/api/stream/movie/${tmdbId}/hls`, request);
}
