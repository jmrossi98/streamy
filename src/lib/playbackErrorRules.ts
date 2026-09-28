/**
 * Which playback failures are real, and which just need another moment.
 *
 * "Playback failed" appeared often enough that clicking again became the
 * normal way to start a title -- and the second click always worked, which is
 * the tell: the first attempt was being reported as failed while it was still
 * a perfectly good attempt. Three causes, each handled here:
 *
 *   - play() rejecting with AbortError. That is the browser saying "a new
 *     source was loaded before this started" -- the direct-play -> transcode
 *     swap, or a late forceTranscode. The swap's own canplay handler starts
 *     playback; the rejection is noise.
 *   - play() rejecting with NotAllowedError: autoplay without a gesture. Not a
 *     failure; the viewer needs to press play, so show the play button.
 *   - hls.js giving up on its first playlist or segment while Jellyfin is
 *     still spinning ffmpeg up. Retried in place (restart loading, or hls.js's
 *     own media-error recovery) before anything is surfaced.
 *
 * Pure: the player wiring lives in usePlayerEngine.ts.
 */

export type PlayRejection = "ignore" | "needs-gesture" | "fail";

export function classifyPlayRejection(err: unknown): PlayRejection {
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError") return "ignore";
  if (name === "NotAllowedError") return "needs-gesture";
  return "fail";
}

/** Fatal hls.js errors retried in place before the viewer sees an error. */
export const HLS_FATAL_RETRIES = 3;

export type HlsFatalAction = "restart-load" | "recover-media" | "give-up";

/**
 * What to do about the Nth fatal hls.js error of one playback.
 *
 * Network errors restart loading (the usual cause is a transcode that has not
 * produced the file yet); media errors use hls.js's recoverMediaError, which
 * exists for exactly the decoder hiccups MSE throws on a fresh stream.
 */
export function hlsFatalAction(errorType: string, attemptsSoFar: number): HlsFatalAction {
  if (attemptsSoFar >= HLS_FATAL_RETRIES) return "give-up";
  if (errorType === "networkError") return "restart-load";
  if (errorType === "mediaError") return "recover-media";
  return "give-up";
}

/**
 * hls.js load policies with room for a cold transcode.
 *
 * The defaults allow a playlist ~10 s and one retry. A cold Jellyfin
 * transcode of a 10-bit HEVC source can take longer than that to produce its
 * first segment, which reached the viewer as an immediate failure.
 */
const retry = (maxNumRetry: number) => ({ maxNumRetry, retryDelayMs: 1000, maxRetryDelayMs: 4000 });
export const HLS_LOAD_CONFIG = {
  manifestLoadPolicy: {
    default: { maxTimeToFirstByteMs: 20_000, maxLoadTimeMs: 30_000, timeoutRetry: retry(4), errorRetry: retry(4) },
  },
  playlistLoadPolicy: {
    default: { maxTimeToFirstByteMs: 20_000, maxLoadTimeMs: 30_000, timeoutRetry: retry(4), errorRetry: retry(4) },
  },
  fragLoadPolicy: {
    default: { maxTimeToFirstByteMs: 20_000, maxLoadTimeMs: 60_000, timeoutRetry: retry(6), errorRetry: retry(6) },
  },
};
