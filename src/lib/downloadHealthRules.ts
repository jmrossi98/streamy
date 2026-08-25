/**
 * Decision rules for the download auto-healer.
 *
 * Deliberately separate from downloadHealer.ts, which reaches out to
 * Radarr/Sonarr/qBittorrent: this file is pure policy with no imports, so the
 * rules can be tested directly without dragging in the whole client stack.
 */

// Grace period before touching anything: a torrent legitimately takes a
// little while to find peers and pull metadata, and we don't want to kill a
// download that was about to start moving.
export const STALL_GRACE_MINUTES = 12;

export type DownloadHealth = {
  /** Radarr/Sonarr's own diagnosis, e.g. "stalled with no connections". */
  errorMessage: string | null;
  /** How long the entry has been sitting in the queue. */
  ageMinutes: number;
  hasProgress: boolean;
};

/** Whether a queue entry is dead enough to be worth dropping and re-grabbing. */
export function isUnhealthy(entry: DownloadHealth): boolean {
  if (entry.ageMinutes < STALL_GRACE_MINUTES) return false;
  // An explicit error from Radarr/Sonarr ("stalled with no connections",
  // "qBittorrent is reporting an error") is reason enough.
  if (entry.errorMessage) return true;
  // No error reported, but still hasn't moved a single byte well past the
  // grace period -- effectively dead too.
  return !entry.hasProgress;
}

/**
 * Whether a dropped release should also be blocklisted.
 *
 * Blocklisting is permanent, so it's reserved for releases that genuinely
 * failed. A plain stall is usually about conditions -- a VPN reconnect, a
 * brief peer drought -- and blocklisting those poisoned the healthiest
 * releases, pushing later searches onto worse-seeded ones.
 */
export function shouldBlocklist(errorMessage: string | null): boolean {
  return /error|failed|corrupt/i.test(errorMessage ?? "");
}
