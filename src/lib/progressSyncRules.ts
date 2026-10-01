/**
 * Streamy and Jellyfin (the Roku) both keep a watch position for the same
 * title. Pure rules for reconciling them.
 *
 * Newest wins, not furthest. "Furthest along" meant a rewind in one app was
 * silently undone by the other's older, larger position -- reported
 * 2026-09-30: Videodrome stopped at 8:30 in Jellyfin, rewound to 8:13, and
 * Streamy kept offering the old spot. Streamy stamps Jellyfin's LastPlayedDate
 * on every save, so both clocks describe the same events.
 */

/** Clock skew and write latency between the two: closer than this is "the same save". */
export const SAME_SAVE_MS = 5_000;

export type StreamySide = { seconds: number; updatedAt: Date } | null;
export type JellyfinSide = { seconds: number | null; played: boolean; lastPlayedAt: Date | null } | null;

/** Whether Jellyfin's state is newer than Streamy's and should replace it. */
export function jellyfinIsNewer(streamy: StreamySide, jellyfin: JellyfinSide): boolean {
  if (!jellyfin?.lastPlayedAt) return false;
  if (!streamy) return jellyfin.played || (jellyfin.seconds ?? 0) > 0;
  return jellyfin.lastPlayedAt.getTime() - streamy.updatedAt.getTime() > SAME_SAVE_MS;
}

/**
 * Where the player should start. A title finished in Jellyfin more recently
 * than Streamy last saved starts over (0) rather than at a stale position.
 */
export function resumeSeconds(streamy: StreamySide, jellyfin: JellyfinSide): number {
  if (jellyfinIsNewer(streamy, jellyfin)) return jellyfin!.played ? 0 : jellyfin!.seconds ?? 0;
  if (streamy) return streamy.seconds;
  return jellyfin && !jellyfin.played ? jellyfin.seconds ?? 0 : 0;
}
