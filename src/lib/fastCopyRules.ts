/**
 * A fast first copy for a movie stuck behind a slow torrent. Pure.
 *
 * The 4K-preferred profile ranks quality above everything, so a 17 GB 4K
 * torrent with five seeders wins over a usenet 1080p that would be on disk in
 * a minute and a half -- and while that torrent is in the queue, Radarr turns
 * every other release away as "already meets cutoff". Measured 2026-10-04:
 * Monster House sat at 1.4 MB/s with 70 minutes to go; a usenet 1080p grabbed
 * alongside it imported in 80 seconds.
 *
 * So when a movie with no file has only a torrent in flight for a while, grab
 * a usenet copy as well. The torrent keeps going and, being the better
 * quality, replaces it as an ordinary upgrade when it lands.
 */

/** How long a torrent gets on its own before a fast copy is started. */
export const FAST_COPY_AFTER_MIN = 10;
/** Usenet copies tried per movie; old posts are often incomplete. */
export const FAST_COPY_MAX_TRIES = 3;

export function wantsFastCopy(entry: {
  protocol: string | null;
  isUpgrade: boolean;
  ageMinutes: number;
  trackedDownloadState: string | null;
}): boolean {
  return (
    entry.protocol === "torrent" &&
    // Already has a file: this download is itself the upgrade.
    !entry.isUpgrade &&
    entry.ageMinutes >= FAST_COPY_AFTER_MIN &&
    // Finished and importing: nothing to speed up.
    entry.trackedDownloadState === "downloading"
  );
}

export type FastCopyRelease = {
  guid: string;
  indexerId: number;
  title: string;
  protocol?: string;
  rejections?: string[];
  customFormatScore?: number;
  ageHours?: number;
  languages?: { name?: string }[];
};

/** The only objection allowed: the torrent already in the queue. */
const QUEUE_ONLY = /queue/i;

/**
 * Usenet releases worth trying, best first. Single-language releases lead:
 * a "German ... MULTi" release passes the original-language rule but plays
 * with the wrong default track on anything that ignores Streamy's preference.
 * Then Radarr's own format score, then newest -- recent posts are the ones
 * most likely to still be complete.
 */
export function pickFastCopies<R extends FastCopyRelease>(releases: R[], alreadyTried: ReadonlySet<string>): R[] {
  return releases
    .filter(
      (r) =>
        r.protocol === "usenet" &&
        !alreadyTried.has(r.title) &&
        (r.rejections ?? []).every((x) => QUEUE_ONLY.test(x))
    )
    .sort(
      (a, b) =>
        Number((a.languages?.length ?? 1) > 1) - Number((b.languages?.length ?? 1) > 1) ||
        (b.customFormatScore ?? 0) - (a.customFormatScore ?? 0) ||
        (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity)
    );
}
