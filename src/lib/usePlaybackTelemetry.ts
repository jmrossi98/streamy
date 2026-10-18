"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { PlaybackKind } from "./viewerActivityRules";
import { queuePlaybackEvent, setPlayingNow, updatePlayingState } from "./presenceClient";

/**
 * Reports how a player is doing to the admin Viewers panel: when it started,
 * how long until the first picture, every stall and how long it lasted, any
 * error the viewer was shown, and when it stopped.
 *
 * Reads the video element's own events, so it works the same for every
 * player and delivery path (hls.js, Safari's native HLS, direct play).
 * `attempt` changes on each fresh tune of the same thing (LivePlayer's
 * retries), so every attempt is its own start.
 *
 * A start is counted from the first `play`, not from mounting: a movie page
 * on a phone waits for a tap, and browsing past it is not a failed start.
 * Live counts from mounting (`startOnMount`), because tuning is the wait.
 */
export function usePlaybackTelemetry(
  videoRef: RefObject<HTMLVideoElement | null>,
  opts: { kind: PlaybackKind; title: string; error: string | null; attempt?: number; active?: boolean; startOnMount?: boolean }
) {
  const { kind, title, error, attempt = 0, active = true, startOnMount = false } = opts;
  const media = `${kind === "live" ? "Live: " : ""}${title}`;
  const mediaRef = useRef(media);
  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active) return;
    let startedAt = 0;
    let played = false;
    let stallAt: number | null = null;
    const begin = () => {
      if (startedAt) return;
      startedAt = Date.now();
      setPlayingNow({ kind, title, state: "tuning", error: null, since: startedAt });
      queuePlaybackEvent("start", media);
    };
    if (startOnMount) begin();

    const onPlay = () => begin();
    const onPlaying = () => {
      begin();
      const now = Date.now();
      if (!played) {
        played = true;
        queuePlaybackEvent("playing", media, null, now - startedAt);
      } else if (stallAt != null) {
        queuePlaybackEvent("stall", media, null, now - stallAt);
      }
      stallAt = null;
      updatePlayingState("playing");
    };
    const onWaiting = () => {
      if (!played || stallAt != null) return;
      stallAt = Date.now();
      updatePlayingState("buffering");
    };
    const onPause = () => {
      if (played && !v.ended) updatePlayingState("paused");
    };
    const onError = () => {
      const msg = v.error ? `media error ${v.error.code}${v.error.message ? `: ${v.error.message}` : ""}` : "media error";
      queuePlaybackEvent("error", media, msg);
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("pause", onPause);
    v.addEventListener("error", onError);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("error", onError);
      if (!startedAt) return;
      if (stallAt != null) queuePlaybackEvent("stall", media, "still stalled when stopped", Date.now() - stallAt);
      queuePlaybackEvent("stop", media, played ? null : "stopped before the picture started", Date.now() - startedAt);
      setPlayingNow(null);
    };
    // media is derived from kind and title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, kind, title, attempt, active, startOnMount]);

  // The error the viewer actually sees, as the player words it.
  useEffect(() => {
    if (!active || !error) return;
    queuePlaybackEvent("error", mediaRef.current, error);
    updatePlayingState("error", error);
  }, [error, active]);

  /** For a player that re-tunes itself: say so, with why. */
  const reportRetry = useCallback((why: string) => queuePlaybackEvent("retry", mediaRef.current, why), []);
  return { reportRetry };
}
