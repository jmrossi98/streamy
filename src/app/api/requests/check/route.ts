import { NextResponse } from "next/server";
import { resolveMediaRequestStatus } from "@/lib/mediaRequests";
import { maybeHealStalledDownloads } from "@/lib/downloadHealer";

// Status is shared/public library state (same as the rest of the movie/show
// detail page), so this doesn't require a session -- anyone can see whether a
// title is already downloading.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get("tmdbId");
  const mediaType = searchParams.get("mediaType");
  if (!tmdbId || (mediaType !== "movie" && mediaType !== "show")) {
    return NextResponse.json({ status: null, progress: null });
  }

  // Fire-and-forget, globally rate-limited: a download that's gone dead gets
  // re-grabbed automatically while the user is still watching the button,
  // instead of sitting at 0% until someone intervenes.
  maybeHealStalledDownloads();

  const result = await resolveMediaRequestStatus(tmdbId, mediaType);
  return NextResponse.json(result);
}
