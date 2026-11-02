/**
 * A second copy of an episode Sonarr already has, or is already fetching.
 *
 * Upgrades are off on every profile, so Sonarr never grabs an episode it
 * holds -- except in a race. On 2026-11-02 a request for Potomac S11E4 set
 * off two searches at once, as every episode request does: the deep search
 * grabbed a 1080p release, and the ordinary EpisodeSearch, still scoring its
 * results, grabbed a 720p 18 s after the 1080p had imported (its view of the
 * episode was from before the import). The 720p replaced the file, and the
 * episode, which was already being played, pointed at a deleted file until
 * Jellyfin noticed.
 *
 * So a grab Sonarr made by itself (RSS or a search) whose episodes are all
 * already on disk, or already coming in another healthy download, is taken
 * back out. A grab someone chose -- an interactive pick or a release push,
 * which is also how Streamy's deep search grabs -- always stands.
 *
 * Pure: the Sonarr calls live in sonarr.ts (dropDuplicateGrab).
 */

/** How a grab was made, per Sonarr's history. These were chosen, not stumbled into. */
const DELIBERATE_SOURCES = new Set(["InteractiveSearch", "ReleasePush"]);

/** Queue states of a download that is on its way to the library. */
const ON_ITS_WAY = new Set(["downloading", "importPending", "importing"]);

export type GrabQueueRecord = {
  downloadId?: string | null;
  episodeId?: number | null;
  trackedDownloadState?: string | null;
  trackedDownloadStatus?: string | null;
};

/** A download that will finish on its own: on its way and with nothing wrong reported. */
export function isHealthyCopy(record: GrabQueueRecord): boolean {
  return ON_ITS_WAY.has(record.trackedDownloadState ?? "") && (record.trackedDownloadStatus ?? "ok") === "ok";
}

export function sameDownload(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether the grab with `downloadId` only duplicates what is already there.
 * Unknown source, or no episodes: not a duplicate -- when in doubt, keep it.
 */
export function isDuplicateGrab(input: {
  releaseSource: string | null | undefined;
  downloadId: string;
  episodes: { id: number; hasFile: boolean }[];
  queue: GrabQueueRecord[];
}): boolean {
  const { releaseSource, downloadId, episodes, queue } = input;
  if (!releaseSource || releaseSource === "Unknown" || DELIBERATE_SOURCES.has(releaseSource)) return false;
  if (episodes.length === 0) return false;
  const otherCopies = queue.filter((r) => !sameDownload(r.downloadId, downloadId) && isHealthyCopy(r));
  return episodes.every((e) => e.hasFile || otherCopies.some((r) => r.episodeId === e.id));
}
