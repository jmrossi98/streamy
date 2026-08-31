"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// Drives a custom control chrome layered over a <video>. The key reason this
// exists rather than using native `controls`: a Jellyfin *transcode* is a
// progressive stream whose reported duration starts tiny and grows as it
// downloads, so the native scrubber visibly resizes. We know the real runtime
// up front (from TMDB), so the scrubber can use a fixed duration and never jump.
//
// The hook owns only chrome state (play/seek/volume/fullscreen/visibility). The
// player keeps its own source, quality, progress-saving and error handling.
export function usePlayerChrome(
  videoRef: RefObject<HTMLVideoElement | null>,
  containerRef: RefObject<HTMLElement | null>,
  opts: {
    knownDurationSeconds?: number | null;
  } = {}
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fixed known runtime wins so the scrubber never resizes mid-transcode; fall
  // back to the element's own duration only when we weren't told the runtime.
  const known = opts.knownDurationSeconds && opts.knownDurationSeconds > 0 ? opts.knownDurationSeconds : 0;
  const duration = known || (Number.isFinite(videoDuration) ? videoDuration : 0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(v.currentTime);
    const onDur = () => setVideoDuration(v.duration);
    const onVol = () => {
      setMuted(v.muted);
      setVolumeState(v.volume);
    };
    const onProgress = () => {
      try {
        if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
      } catch {
        /* buffered can throw before metadata; ignore */
      }
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("loadedmetadata", onDur);
    v.addEventListener("volumechange", onVol);
    v.addEventListener("progress", onProgress);
    // Seed from current element state (source may already be playing).
    setIsPlaying(!v.paused);
    setMuted(v.muted);
    setVolumeState(v.volume);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("loadedmetadata", onDur);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("progress", onProgress);
    };
  }, [videoRef]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );

  // Show the controls and arm the auto-hide. Held open while paused.
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 3200);
  }, [videoRef]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    revealControls();
  }, [videoRef, revealControls]);

  // One code path for both direct play and a transcode: a transcode's HLS
  // playlist spans the whole title, so hls.js just fetches the segment at the
  // target and Jellyfin encodes it on demand. This used to hand transcodes off
  // to a caller-supplied handler that tore the stream down and rebuilt it at
  // the new position, which was both slower and wrong (see usePlayerEngine's
  // videoSrc).
  const seek = useCallback(
    (target: number) => {
      revealControls();
      const v = videoRef.current;
      if (!v) return;
      // Guard against seeking into a range the element can't serve yet -- an
      // out-of-range set can stall a partially-buffered source. Clamp to
      // what's seekable; otherwise leave playback alone.
      try {
        let clamped = target;
        if (v.seekable && v.seekable.length > 0) {
          const end = v.seekable.end(v.seekable.length - 1);
          const start = v.seekable.start(0);
          clamped = Math.min(Math.max(target, start), end);
        }
        v.currentTime = clamped;
        setCurrentTime(clamped);
      } catch {
        /* not seekable yet; ignore */
      }
    },
    [videoRef, revealControls]
  );

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    revealControls();
  }, [videoRef, revealControls]);

  const setVolume = useCallback(
    (value: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.volume = value;
      v.muted = value === 0;
      revealControls();
    },
    [videoRef, revealControls]
  );

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    const v = videoRef.current;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {
        // iOS doesn't allow element fullscreen -- use the video's own.
        const iosVideo = v as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
        iosVideo?.webkitEnterFullscreen?.();
      });
    } else {
      const iosVideo = v as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      iosVideo?.webkitEnterFullscreen?.();
    }
  }, [containerRef, videoRef]);

  return {
    isPlaying,
    currentTime,
    duration,
    buffered,
    muted,
    volume,
    isFullscreen,
    controlsVisible,
    revealControls,
    setControlsVisible,
    togglePlay,
    seek,
    toggleMute,
    setVolume,
    toggleFullscreen,
  };
}

/** Formats seconds as H:MM:SS or M:SS. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
