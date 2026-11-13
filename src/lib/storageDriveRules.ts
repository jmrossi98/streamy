/**
 * How full one drive of the /data pool is, and whether to say so (2026-11-13).
 *
 * mergerfs keeps each show and movie folder on the drive it is already on, so
 * one drive can fill while the pool as a whole looks roomy -- the pool's own
 * percentage hides exactly the case worth knowing about. Pure.
 */

/** From here a drive is worth a look: on an 8 TB drive, 1.2 TB left. */
export const DRIVE_WARN_PCT = 85;
/**
 * And from here it is a problem: where ext4 starts fragmenting badly, and the
 * level of the 2026-09-15 I/O-pressure incident (91% on this box). Same line
 * as the health rows in serviceStatus.ts.
 */
export const DRIVE_FULL_PCT = 90;

export type DriveFullness = { usedPct: number; state: "ok" | "filling" | "full" };

export function driveFullness(totalBytes: number, freeBytes: number): DriveFullness {
  if (!(totalBytes > 0)) return { usedPct: 0, state: "ok" };
  const usedPct = Math.round(((totalBytes - Math.max(freeBytes, 0)) / totalBytes) * 100);
  const state = usedPct >= DRIVE_FULL_PCT ? "full" : usedPct >= DRIVE_WARN_PCT ? "filling" : "ok";
  return { usedPct, state };
}
