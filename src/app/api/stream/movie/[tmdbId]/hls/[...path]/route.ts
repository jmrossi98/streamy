import { getSession, getValidSessionUserId } from "@/lib/auth";
import { findJellyfinMovieItemId } from "@/lib/jellyfin";
import { proxyJellyfinHlsResource } from "@/lib/streamProxy";
import { chooseAudio, getLanguagePlan } from "@/lib/playbackLanguage";

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

  const resource = path.join("/");
  // Only the master picks the audio track; Jellyfin carries it from there.
  const audio =
    resource === "master.m3u8"
      ? chooseAudio(await getLanguagePlan(itemId, "movie", tmdbId), new URL(request.url).searchParams.get("audio"))
      : null;
  return proxyJellyfinHlsResource(itemId, resource, `/api/stream/movie/${tmdbId}/hls`, request, undefined, audio);
}
