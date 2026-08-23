import { prisma } from "./db";
import { getRadarrLiveStatus, getRadarrDownloadProgress, type MediaRequestStatus } from "./radarr";
import { getSonarrLiveStatus, getSonarrDownloadProgress } from "./sonarr";

export type ResolvedRequestStatus = { status: MediaRequestStatus | null; progress: number | null };

/**
 * Loads a title's shared MediaRequest row and, if it's marked "downloading",
 * re-verifies that against Radarr/Sonarr's live queue. A download can be
 * cancelled or cleared directly in Radarr/Sonarr/qBittorrent (outside
 * Streamy's own request flow), and the webhook that would normally update
 * status never fires for that -- so a stale "downloading" row is cleared
 * entirely here, putting the title back in its original, un-requested state
 * rather than showing a download that isn't actually happening.
 */
export async function resolveMediaRequestStatus(
  tmdbId: string,
  mediaType: "movie" | "show"
): Promise<ResolvedRequestStatus> {
  const row = await prisma.mediaRequest.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
  });
  if (!row) return { status: null, progress: null };

  if (row.status !== "downloading" || !row.externalId) {
    return { status: row.status as MediaRequestStatus, progress: null };
  }

  const liveStatus =
    mediaType === "movie"
      ? await getRadarrLiveStatus(row.externalId)
      : await getSonarrLiveStatus(row.externalId);

  if (liveStatus === null) {
    // Radarr/Sonarr unreachable -- don't wipe a real request over a
    // transient error, just report the last known status.
    return { status: "downloading", progress: null };
  }

  if (liveStatus === "available") {
    await prisma.mediaRequest.update({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
      data: { status: "available" },
    });
    return { status: "available", progress: null };
  }

  if (liveStatus === "downloading") {
    const progress =
      mediaType === "movie"
        ? await getRadarrDownloadProgress(row.externalId)
        : await getSonarrDownloadProgress(row.externalId);
    return { status: "downloading", progress };
  }

  // liveStatus is "requested": Radarr/Sonarr confirmed the item isn't in the
  // active queue and isn't available, meaning it was cancelled/removed
  // outside Streamy's own request flow. Clear the stale row.
  await prisma.mediaRequest.delete({ where: { tmdbId_mediaType: { tmdbId, mediaType } } });
  return { status: null, progress: null };
}
