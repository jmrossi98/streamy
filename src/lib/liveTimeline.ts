/**
 * The arithmetic behind a live scrubber.
 *
 * Extracted from VideoChrome so it can be tested without a browser, a stream
 * or a rendered component. A broadcast timeline is the one part of the player
 * where the maths is not obvious: both ends of the bar move while you are
 * looking at it, which makes off-by-one errors read as the control drifting
 * rather than as a bug.
 */

/** Dragging within this many seconds of the edge counts as asking for live. */
export const LIVE_SNAP_SECONDS = 5;

/**
 * Where a point sits along the seekable window, as a percentage.
 *
 * Clamped at both ends: `currentTime` can legitimately sit a fraction outside
 * the window, because the window is re-read on a timer while playback keeps
 * moving between reads.
 */
export function liveTrackPercent(t: number, windowStart: number, edge: number): number {
  const span = edge - windowStart;
  if (!Number.isFinite(span) || span <= 0) return 0;
  const pct = ((t - windowStart) / span) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Whether a seek target should be treated as "take me back to live".
 *
 * Without this, the right-most position is one you can never quite land on:
 * the edge advances while the pointer is moving, so a drag to the end lands a
 * second or two behind and stays there. That reads as the control being
 * broken, not as being two seconds late.
 */
export function shouldSnapToLive(
  target: number,
  edge: number,
  toleranceSeconds: number = LIVE_SNAP_SECONDS
): boolean {
  if (!Number.isFinite(target) || !Number.isFinite(edge)) return false;
  return target >= edge - toleranceSeconds;
}

/**
 * How far behind live a position is, never negative.
 *
 * Playback can briefly report a time past the last-read edge for the same
 * reason as above; "-0:-2 behind" is not a thing worth rendering.
 */
export function secondsBehindLive(currentTime: number, edge: number): number {
  const behind = edge - currentTime;
  if (!Number.isFinite(behind)) return 0;
  return Math.max(0, behind);
}

/**
 * Whether to call this live.
 *
 * Deliberately not zero. Every HLS live stream sits a few segments back from
 * the edge by design, so an exact comparison would mean the badge never says
 * live and a "go live" button that never turns itself off.
 */
export function isAtLiveEdge(
  currentTime: number,
  edge: number,
  toleranceSeconds: number = 20
): boolean {
  return secondsBehindLive(currentTime, edge) <= toleranceSeconds;
}
