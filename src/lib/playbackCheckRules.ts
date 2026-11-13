/**
 * Which release the daily playback check downloads (2026-11-13). Pure.
 *
 * The check used to let Radarr's search pick, and Radarr picked the same thing
 * every day from Nov 4: a small 720p public torrent (RARBG, via
 * TorrentDownload) whose swarm never delivered it inside the 10-minute window.
 * Twelve failure emails in a row, every one "failed at download + import".
 * Profile 3 ranks 720p first and quality outranks protocol, while the 720p
 * usenet copies (5-6 GB) are over the 720p size cap -- so a dead 720p torrent
 * beat a 1.8 GB 1080p usenet copy that would have arrived in a minute.
 *
 * The check is meant to test Streamy's pipeline, not one torrent's swarm, so
 * it chooses the release itself: the smallest acceptable usenet copy (fast,
 * and the provider is ours), and only without one the best-seeded torrent.
 */

export type TestReleaseCandidate = {
  guid: string;
  indexerId: number;
  title: string;
  /** "usenet" or "torrent", as Radarr names it. */
  protocol: string;
  /** Bytes. */
  size: number;
  rejected?: boolean;
  rejections?: string[];
  seeders?: number | null;
};

/** Under this a "movie" is a sample, a fake or a split part. */
export const MIN_TEST_RELEASE_BYTES = 400 * 1024 ** 2;
/** Over this it would not reliably download and import inside the window. */
export const MAX_TEST_RELEASE_BYTES = 12 * 1024 ** 3;
/** A torrent with fewer seeders than this is the swarm that failed for twelve days. */
export const MIN_TEST_TORRENT_SEEDERS = 5;

export function pickTestRelease<R extends TestReleaseCandidate>(releases: R[]): R | null {
  const usable = releases.filter(
    (r) =>
      !r.rejected &&
      (r.rejections?.length ?? 0) === 0 &&
      r.size >= MIN_TEST_RELEASE_BYTES &&
      r.size <= MAX_TEST_RELEASE_BYTES
  );
  const usenet = usable.filter((r) => r.protocol === "usenet").sort((a, b) => a.size - b.size);
  if (usenet[0]) return usenet[0];
  const torrents = usable
    .filter((r) => r.protocol === "torrent" && (r.seeders ?? 0) >= MIN_TEST_TORRENT_SEEDERS)
    .sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0) || a.size - b.size);
  return torrents[0] ?? null;
}

/** "Night.of.the.Living.Dead...x265 (usenet, 1.8 GB)" for the run's detail. */
export function describeTestRelease(r: Pick<TestReleaseCandidate, "title" | "protocol" | "size">): string {
  return `${r.title} (${r.protocol}, ${(r.size / 1024 ** 3).toFixed(1)} GB)`;
}
