"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { spaceTogglesPlayback } from "./playerKeyRules";

// Drives a custom control chrome layered over a <video>, in place of native
// `controls`. The scrubber shows the known runtime until the element reports
// the file's own length (see `duration` below).
//
// The hook owns only chrome state (play/seek/volume/fullscreen/visibility). The
// player keeps its own source, quality, progress-saving and error handling.
/** How long the controls stay up after the last mouse move, tap or play. */
const HIDE_AFTER_MS = 3200;
/** Mouse moves closer together than this re-arm nothing. */
const REVEAL_THROTTLE_MS = 250;

export function usePlayerChrome(
  videoRef: RefObject<HTMLVideoElement | null>,
  containerRef: RefObject<HTMLElement | null>,
  opts: {
    knownDurationSeconds?: number | null;
    /** False while something covers the picture (the start or error overlay): keys are left alone. */
    keysEnabled?: boolean;
    /** What fullscreen enlarges, when not containerRef -- the episode player's
     * frame, which outlives each episode's own player so fullscreen survives
     * rolling on to the next one. */
    fullscreenRef?: RefObject<HTMLElement | null>;
  } = {}
) {
  const fullscreenRef = opts.fullscreenRef ?? containerRef;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(1);
  // The last level the viewer actually heard, so unmuting from a zero volume
  // has something to come back to rather than staying silent.
  const lastVolumeRef = useRef(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the button was pressed in a fullscreen only the keyboard can leave.
  const [fullscreenHint, setFullscreenHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The file's own length once the element knows it; the known runtime only
  // until then. The known runtime is TMDB's, rounded to the minute and often
  // off: Clone High's "22 min" files are 21:30, so the scrubber ran 30 s past
  // the end (2026-10-17). It once had to win because a transcode was a
  // progressive stream whose length grew as it downloaded; transcodes are
  // full-timeline HLS now, which reports the whole length up front.
  const known = opts.knownDurationSeconds && opts.knownDurationSeconds > 0 ? opts.knownDurationSeconds : 0;
  const duration = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : known;

  // Starts the countdown that fades the controls out. Playback starting arms
  // it too, not only a mouse move: live TV and autoplay start on their own,
  // and with nothing to arm the timer the controls never left the picture.
  const armHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, HIDE_AFTER_MS);
  }, [videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => {
      setIsPlaying(true);
      armHide();
    };
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(v.currentTime);
    const onDur = () => setVideoDuration(v.duration);
    const onVol = () => {
      setMuted(v.muted);
      setVolumeState(v.volume);
      if (v.volume > 0) lastVolumeRef.current = v.volume;
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
    if (!v.paused) armHide();
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
  }, [videoRef, armHide]);

  // Two different fullscreens. The button's own is the Fullscreen API, which
  // the page can enter and leave. F11 is the browser's: the page can see it
  // (the display-mode media query) but has no way to leave it. Both count as
  // fullscreen for the icon; only the first can be undone from here.
  useEffect(() => {
    const browserFs = window.matchMedia("(display-mode: fullscreen)");
    const onFs = () => {
      setIsFullscreen(!!document.fullscreenElement || browserFs.matches);
      if (!browserFs.matches) setFullscreenHint(false);
    };
    onFs();
    document.addEventListener("fullscreenchange", onFs);
    browserFs.addEventListener("change", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      browserFs.removeEventListener("change", onFs);
    };
  }, []);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    []
  );

  // Show the controls and arm the auto-hide. Held open while paused.
  //
  // A mouse sends dozens of moves a second, and each one used to clear and
  // re-set the hide timer on the same thread hls.js appends media on. Only
  // the first move in a short window does anything; the hide then lands at
  // most that much early, which nobody can see.
  const lastRevealRef = useRef(0);
  const revealControls = useCallback(() => {
    const now = Date.now();
    if (now - lastRevealRef.current < REVEAL_THROTTLE_MS) return;
    lastRevealRef.current = now;
    setControlsVisible(true);
    armHide();
  }, [armHide]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    revealControls();
  }, [videoRef, revealControls]);

  // Space is play/pause. Listened for on the window because nothing in the
  // player holds focus when a title starts, so the press lands on <body>.
  const keysEnabled = opts.keysEnabled ?? true;
  useEffect(() => {
    if (!keysEnabled) return;
    const wanted = (e: KeyboardEvent) => {
      const v = videoRef.current;
      // Nothing loaded yet: no picture to toggle.
      if (!v || v.readyState === 0) return false;
      const target = e.target instanceof HTMLElement ? e.target : null;
      return spaceTogglesPlayback({
        key: e.key,
        repeat: e.repeat,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: target?.tagName,
        targetType: target instanceof HTMLInputElement ? target.type : null,
        targetEditable: target?.isContentEditable,
        targetInPlayer: !!target && !!containerRef.current?.contains(target),
      });
    };
    // Whether the focused control got its focus from a click rather than Tab.
    // A clicked button keeps focus without showing it; the first key press
    // then makes the browser draw its focus ring, so space lit up whatever was
    // clicked last. That focus is let go. Focus someone tabbed to is theirs.
    let focusFromPointer = false;
    const onPointerDown = (e: PointerEvent) => {
      focusFromPointer = e.target instanceof Node && !!containerRef.current?.contains(e.target);
    };
    // A control that was clicked does not keep the keyboard. Left focused, the
    // seek bar took the next key press for itself: arrows nudged it, and any
    // key at all drew its focus ring. Let go once the click has been handled
    // (hence the timeout); focus reached with Tab is left alone, and so is a
    // text field, which is clicked in order to type.
    const onPointerUp = () => {
      if (!focusFromPointer) return;
      setTimeout(() => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || !containerRef.current?.contains(focused)) return;
        const typing =
          focused instanceof HTMLTextAreaElement ||
          focused.isContentEditable ||
          (focused instanceof HTMLInputElement && !["range", "button", "checkbox", "radio"].includes(focused.type));
        if (!typing) focused.blur();
      }, 0);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") focusFromPointer = false;
      if (!wanted(e)) return;
      // Otherwise the page scrolls, or a focused control is pressed as well.
      e.preventDefault();
      const focused = document.activeElement;
      if (focusFromPointer && focused instanceof HTMLElement && containerRef.current?.contains(focused)) focused.blur();
      togglePlay();
    };
    // A focused button fires its click on key *up* in some browsers, which
    // would mute or leave fullscreen on top of the toggle above.
    const onKeyUp = (e: KeyboardEvent) => {
      if (wanted(e)) e.preventDefault();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [videoRef, containerRef, togglePlay, keysEnabled]);

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
    // The icon shows "silent" for two states: muted, and volume at 0. A plain
    // !muted flip unmuted a zero-volume element to no sound and the struck-out
    // icon stayed, so the button looked dead. Unmuting restores a level.
    if (v.muted || v.volume === 0) {
      v.muted = false;
      if (v.volume === 0) v.volume = lastVolumeRef.current > 0 ? lastVolumeRef.current : 1;
    } else {
      v.muted = true;
    }
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
    const el = fullscreenRef.current;
    const v = videoRef.current;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    // Fullscreen from F11. Asking for element fullscreen here would "work"
    // and change nothing on screen, which is how the button came to look dead.
    // Say what does leave it instead.
    if (window.matchMedia("(display-mode: fullscreen)").matches) {
      setFullscreenHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setFullscreenHint(false), 4000);
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
  }, [fullscreenRef, videoRef]);

  return {
    isPlaying,
    currentTime,
    duration,
    buffered,
    muted,
    volume,
    isFullscreen,
    fullscreenHint,
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
