import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRadarrDownloadProgress } from "@/lib/radarr";
import { getSonarrDownloadProgress } from "@/lib/sonarr";

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

  const row = await prisma.mediaRequest.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
  });
  if (!row) {
    return NextResponse.json({ status: null, progress: null });
  }

  let progress: number | null = null;
  if (row.status === "downloading" && row.externalId) {
    progress =
      mediaType === "movie"
        ? await getRadarrDownloadProgress(row.externalId)
        : await getSonarrDownloadProgress(row.externalId);
  }

  return NextResponse.json({ status: row.status, progress });
}
