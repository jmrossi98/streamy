import { prisma } from "./db";
import {
  getRadarrLiveStatus,
  getRadarrDownloadProgress,
  getRadarrStatusByTmdbId,
  type MediaRequestStatus,
} from "./radarr";
import { getSonarrLiveStatus, getSonarrDownloadProgress } from "./sonarr";

export type ResolvedRequestStatus = { status: MediaRequestStatus | null; progress: number | null };

// How long a title may sit in "searching" (in Radarr/Sonarr, not queued, no
// file) before we treat it as genuinely gone rather than mid-re-grab. Long
// enough to cover an auto-heal's cancel -> re-search -> grab round trip.
const STALE_REQUEST_MS = 20 * 60 * 1000;

/**
 * Loads a title's shared MediaRequest row and re-verifies it against
 * Radarr/Sonarr's live state. A download can be cancelled, cleared, or
 * completed directly in Radarr/Sonarr/qBittorrent (outside Streamy's own
 * request flow) without the webhook that would normally update status ever
 * firing -- so the stored status is treated as a hint and the live state
 * wins, keeping the Download button honest in every direction.
 */
export async function resolveMediaRequestStatus(
  tmdbId: string,
  mediaType: "movie" | "show"
): Promise<ResolvedRequestStatus> {
  const row = await prisma.mediaRequest.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
  });

  if (!row) {
    // No local row doesn't mean nothing is happening. Rows get cleared when a
    // title looks idle, and the auto-healer starts searches on its own, so
    // Radarr can be mid-download for something Streamy has no record of --
    // which showed an idle Download button while the file was on its way.
    // Radarr is the source of truth here, so ask it directly.
    if (mediaType === "movie") {
      const live = await getRadarrStatusByTmdbId(tmdbId);
      if (!live || live.status === "requested") return { status: null, progress: null };
      const progress =
        live.status === "downloading" ? await getRadarrDownloadProgress(live.radarrId) : null;
      return { status: live.status, progress };
    }
    return { status: null, progress: null };
  }

  const storedStatus = row.status as MediaRequestStatus;
  if (!row.externalId) {
    return { status: storedStatus, progress: null };
  }

  const liveStatus =
    mediaType === "movie"
      ? await getRadarrLiveStatus(row.externalId)
      : await getSonarrLiveStatus(row.externalId);

  if (liveStatus === null) {
    // Radarr/Sonarr unreachable -- don't rewrite a real request over a
    // transient error, just report the last known status.
    return { status: storedStatus, progress: null };
  }

  if (liveStatus === "cancelled") {
    // Radarr/Sonarr has stopped wanting this (cancelled here, from the admin
    // panel, or directly in Radarr). No search will ever run, so clear the
    // row immediately rather than leaving the button on "searching".
    await prisma.mediaRequest.delete({ where: { tmdbId_mediaType: { tmdbId, mediaType } } });
    return { status: null, progress: null };
  }

  if (liveStatus === "available") {
    if (storedStatus !== "available") {
      await prisma.mediaRequest.update({
        where: { tmdbId_mediaType: { tmdbId, mediaType } },
        data: { status: "available" },
      });
    }
    return { status: "available", progress: null };
  }

  if (liveStatus === "downloading") {
    if (storedStatus !== "downloading") {
      await prisma.mediaRequest.update({
        where: { tmdbId_mediaType: { tmdbId, mediaType } },
        data: { status: "downloading" },
      });
    }
    const progress =
      mediaType === "movie"
        ? await getRadarrDownloadProgress(row.externalId)
        : await getSonarrDownloadProgress(row.externalId);
    return { status: "downloading", progress };
  }

  // Searched and came up with nothing that cleared the quality/seeder bar --
  // distinct from "requested" (still actively searching), which otherwise
  // looks identical to a viewer as an indefinite spinner. Reported directly
  // rather than folded into the staleness logic below: this is an explicit
  // signal from Radarr's own lastSearchTime, not an inferred one, and it
  // should show up the moment it's true rather than after another wait.
  // The row stays (not cleared) so a later auto-heal re-search can still
  // resolve it forward if a release shows up.
  if (liveStatus === "noReleaseFound") {
    if (storedStatus !== "noReleaseFound") {
      await prisma.mediaRequest.update({
        where: { tmdbId_mediaType: { tmdbId, mediaType } },
        data: { status: "noReleaseFound" },
      });
    }
    return { status: "noReleaseFound", progress: null };
  }

  // liveStatus is "requested": in Radarr/Sonarr, but neither downloading nor
  // available. Two very different situations share this shape -- a download
  // that was just dropped and re-searched (by the auto-healer or a manual
  // re-grab), which is about to become a real download again, and one that
  // was cancelled outside Streamy and is never coming back.
  //
  // Treat it as "searching" first and only clear the row once it has stayed
  // that way past the grace window. Clearing immediately would bounce the
  // user back to an idle Download button mid-heal. (liveStatus is genuinely
  // "requested" here, not "noReleaseFound" -- that returned above -- so this
  // also correctly catches a fresh re-search moving off a stale
  // "noReleaseFound" row, resetting updatedAt for the staleness check below.)
  if (storedStatus !== "requested") {
    await prisma.mediaRequest.update({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
      data: { status: "requested" },
    });
    return { status: "requested", progress: null };
  }

  const searchingForMs = Date.now() - row.updatedAt.getTime();
  if (searchingForMs < STALE_REQUEST_MS) {
    return { status: "requested", progress: null };
  }

  await prisma.mediaRequest.delete({ where: { tmdbId_mediaType: { tmdbId, mediaType } } });
  return { status: null, progress: null };
}
