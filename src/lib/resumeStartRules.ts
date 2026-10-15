/**
 * Where a resumed title starts, and when that is known well enough to start.
 *
 * The page that renders a player carries a resume point, but it can be stale
 * (the play page is fully prefetched, and the show page's overlay keeps the
 * value from when the show page loaded), so the player re-asks
 * /api/resume-point on open (useFreshResume). Until 2026-10-15 nothing waited
 * for that answer: a transcode started at the page's position -- hls.js's
 * startPosition, Safari's native player from 0 -- and when the fresh answer
 * moved, the start sequence re-ran and seeked to it. Jellyfin addresses HLS
 * segments by index and runs one ffmpeg per session, so that seek killed the
 * encode it had just started and cold-started a second one at the new spot,
 * while play() was already pending on the first (Jellyfin's logs show these
 * start-then-restart-with--ss pairs seconds apart). On a 4K source each cold
 * start is seconds of ffmpeg spin-up; clicking again worked because by then
 * the second encode was warm and the position settled -- the reported
 * "Resume fails the first time, retry plays".
 *
 * Pure: the player wiring lives in useFreshResume.ts and usePlayerEngine.ts.
 */

/** Below this, two positions are the same spot. */
export const RESUME_MOVED_SEC = 5;

/**
 * How long a transcode waits for the fresh resume point before starting from
 * the page's value anyway. The answer normally takes a few hundred ms; the
 * cap only matters when the server is slow, and is far shorter than the
 * cold-start it saves.
 */
export const RESUME_ANSWER_WAIT_MS = 2_000;

/**
 * Once playback is under way, a late resume answer only moves it if the
 * viewer is still near where it started -- not if they have since scrubbed.
 */
export const LATE_RESUME_WINDOW_SEC = 30;

/**
 * The position to resume at, given the one in hand and a fresh answer (null
 * when the question could not be asked). A small difference is the same spot
 * and keeps the value in hand, so nothing re-seeks for it.
 */
export function pickResumeSeconds(current: number, fresh: number | null): number {
  if (fresh == null) return current;
  return Math.abs(fresh - current) > RESUME_MOVED_SEC ? fresh : current;
}

/**
 * Whether a transcode may start yet. Direct play never waits -- a seek in a
 * plain file is a Range request, not a new encode -- so only a transcode is
 * held, and only until the fresh resume point is in (or has timed out).
 */
export function holdTranscodeForResume(transcoding: boolean, resumeSettled: boolean): boolean {
  return transcoding && !resumeSettled;
}

/**
 * Whether a resume point that changed after playback began should move it.
 *
 * `startedAt` is the position the start sequence already sought to (null if it
 * has not run yet -- then the new value is simply used when it does, and
 * nothing needs moving). The playhead is moved only when the new value is a
 * different spot and the viewer has not wandered off from the start.
 */
export function shouldMoveStartedPlayback(
  startedAt: number | null,
  resumeAt: number,
  currentTime: number
): boolean {
  if (startedAt == null) return false;
  if (Math.abs(resumeAt - startedAt) <= RESUME_MOVED_SEC) return false;
  return Math.abs(currentTime - startedAt) <= LATE_RESUME_WINDOW_SEC;
}
