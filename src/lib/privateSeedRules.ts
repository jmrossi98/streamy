/**
 * When a private tracker's torrent may stop seeding. Pure.
 *
 * Joined TorrentLeech 2026-10-16. Its hit-and-run rules (Registered class):
 *
 *  - a finished torrent must reach a 1:1 ratio, or seed 10 days in total;
 *  - a partial one never earns seed time: once 10% of it is downloaded it
 *    must upload what it downloaded;
 *  - "seeding" means loaded and active in the client -- paused, stopped or
 *    sitting in qBittorrent's queue all count as stopped;
 *  - the tracker updates about every 30 minutes, so a torrent removed the
 *    moment the client says 1.00 can still land on the list.
 *
 * 50 hit-and-runs left standing for five days is a warning; three warnings
 * disable the account. So every path that stops, deletes or cancels a torrent
 * asks this first, and mediabox's private-seed-guard keeps unsafe ones forced
 * active. Margins (1.05, an extra day) cover the tracker's lag.
 *
 * The same rule lives in mediabox-infra scripts/private_seed.py; change both.
 */

export type SeedState = {
  /** The torrent came from a private tracker (qBittorrent's `private` flag). */
  isPrivate: boolean;
  /** 0..1 */
  progress: number;
  ratio: number;
  /** Seconds spent seeding (finished), as qBittorrent counts it. */
  seedingTime: number;
  /** Bytes downloaded and uploaded this session and before. */
  downloaded: number;
  uploaded: number;
};

/** TL's minimum seed time for the Registered class, plus a day for the tracker to catch up. */
export const MIN_SEED_DAYS = 10 + 1;
/** TL's 1:1, with room for the tracker counting a little less than the client. */
export const SAFE_RATIO = 1.05;
/** Below this much downloaded, TL does not count a partial torrent at all. */
export const PARTIAL_THRESHOLD = 0.1;

/** Whether stopping this torrent now could earn a hit-and-run. Public torrents never can. */
export function mustKeepSeeding(t: SeedState): boolean {
  if (!t.isPrivate) return false;
  if (t.progress >= 1) {
    return !(t.ratio >= SAFE_RATIO || t.seedingTime >= MIN_SEED_DAYS * 86_400);
  }
  if (t.progress < PARTIAL_THRESHOLD) return false;
  return t.uploaded < t.downloaded * SAFE_RATIO;
}
