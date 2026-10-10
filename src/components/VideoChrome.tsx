"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatTime } from "@/lib/usePlayerChrome";
import { liveTrackPercent } from "@/lib/liveTimeline";

type ChromeState = {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  muted: boolean;
  volume: number;
  isFullscreen: boolean;
  /** The button was pressed in an F11 fullscreen, which only F11 leaves. */
  fullscreenHint?: boolean;
  controlsVisible: boolean;
  togglePlay: () => void;
  seek: (t: number) => void;
  toggleMute: () => void;
  setVolume: (v: number) => void;
  toggleFullscreen: () => void;
};

/**
 * Live playback, where a timeline means something different.
 *
 * A broadcast has no duration and no fixed start, and no scrubber either --
 * see the bottom control bar below. Catching back up to the edge after
 * falling behind (a pause, a stall) is LivePlayer's own job now, done
 * automatically rather than offered as a button -- so all this describes is
 * whether playback is currently at the edge, for the badge's colour.
 */
export type LiveState = {
  /** At (or close enough to) the edge to call it live. */
  atLive: boolean;
};

// A single unified control overlay for the movie, episode and live players.
// Replaces the native <video controls> (whose scrubber resizes during a
// transcode) plus the old scattered title/quality/maximize overlays.
/**
 * Must match the `duration-300` on the controls root below. Kept as a named
 * constant because the two have to agree: if the class is longer than this,
 * the controls go inert while still visible -- which is the bug this exists
 * to prevent.
 */
const CONTROLS_FADE_MS = 300;

export function VideoChrome({
  title,
  subtitle,
  closeHref,
  onClose,
  chrome,
  live,
  busy,
  extraTopRight,
  extraBottomRight,
}: {
  title: string;
  subtitle?: string;
  closeHref?: string;
  onClose?: () => void;
  chrome: ChromeState;
  /** Present only for a broadcast. Switches the timeline to DVR semantics. */
  live?: LiveState;
  /**
   * The picture is loading or has run out of buffer, and the player is
   * drawing its spinner. The big play button stands down: it reads as
   * "paused, press to start" over something that is already starting.
   */
  busy?: boolean;
  extraTopRight?: React.ReactNode;
  /** Rendered in the bottom bar, left of fullscreen -- e.g. a "next episode" button. */
  extraBottomRight?: React.ReactNode;
}) {
  const {
    isPlaying,
    currentTime,
    duration,
    buffered,
    muted,
    volume,
    isFullscreen,
    fullscreenHint,
    controlsVisible,
    togglePlay,
    seek,
    toggleMute,
    setVolume,
    toggleFullscreen,
  } = chrome;

  // VOD only now -- live has no scrubber to map a track onto (see the bottom
  // bar below). liveTimeline.ts still owns this arithmetic so it stays
  // unit-tested without a browser.
  const along = (t: number) => liveTrackPercent(t, 0, duration);

  /*
    While the thumb is being dragged, the drag wins.

    A bar driven purely by playback state fights the finger: the value is
    recomputed underneath the drag and the thumb springs back. Holding the
    dragged value until release is what makes scrubbing feel attached to the
    pointer rather than advisory.
  */
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragging = dragValue !== null;

  const pct = dragging ? along(dragValue) : along(currentTime);
  const bufPct = along(buffered);
  const onSeek = seek;

  const show = controlsVisible || !isPlaying;
  // The root never captures pointer events -- only the bars/buttons do -- so
  // clicks on the empty middle fall through to the <video> (tap to toggle/reveal).
  //
  // Interactivity lags the hide by the length of the fade. `show` flips false
  // the moment the auto-hide timer fires, but the controls stay on screen for
  // the full 300ms transition, and dropping pointer-events immediately left a
  // window where a plainly visible button did nothing when pressed. That is
  // the "sometimes the exit button won't close" report, and on a phone -- where
  // a tap takes longer to arrive than a click -- it is easy to land in.
  //
  // Only the hide is delayed. Showing is instant, and once the fade has
  // finished the bars really are gone, so taps fall through to the video
  // again as they should.
  const [interactable, setInteractable] = useState(show);
  useEffect(() => {
    if (show) {
      setInteractable(true);
      return;
    }
    const t = setTimeout(() => setInteractable(false), CONTROLS_FADE_MS);
    return () => clearTimeout(t);
  }, [show]);
  const interactive = interactable ? "pointer-events-auto" : "pointer-events-none";

  return (
    <div
      className={`absolute inset-0 z-20 transition-opacity duration-300 pointer-events-none ${
        show ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Top bar: title (+ subtitle) left, quality + close right. */}
      <div className={`absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 py-3 sm:px-6 sm:py-4 ${interactive}`}>
        <div className="min-w-0 pt-1">
          <p className="truncate text-base font-semibold text-white drop-shadow-md sm:text-lg">{title}</p>
          {subtitle && <p className="truncate text-xs text-white/70 sm:text-sm">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {extraTopRight}
          {(closeHref || onClose) &&
            (closeHref ? (
              <Link
                href={closeHref}
                prefetch
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 active:bg-black/80 touch-manipulation"
              >
                <CloseIcon />
              </Link>
            ) : (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 active:bg-black/80 touch-manipulation"
              >
                <CloseIcon />
              </button>
            ))}
        </div>
      </div>

      {/* Center play/pause -- big tap target, shown when paused. */}
      {!isPlaying && !busy && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className={`absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-netflix-black shadow-xl transition-transform hover:scale-105 active:scale-95 touch-manipulation sm:h-20 sm:w-20 ${interactive}`}
        >
          <svg className="ml-1 h-8 w-8 sm:h-10 sm:w-10" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}

      {/* Bottom control bar. */}
      <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-3 pt-8 sm:px-5 sm:pb-4 ${interactive}`}>
        {/*
          Scrubber -- VOD only.

          A live broadcast used to get one too, spanning the DVR window, but a
          draggable bar is an offer to seek, and the only two things dragging
          one back actually did were let you re-watch a few minutes (nobody
          asked for it) or land you stalled a few seconds off the live edge
          (everybody hit this by accident). Every no-frills live platform skips
          the bar entirely rather than build a scrubber whose only reliable use
          is confusing the person holding it -- the LIVE indicator below is the
          entire live transport control now.
        */}
        {!live && (
          <div className="group relative flex h-4 items-center">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
              <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${bufPct}%` }} />
              <div className="absolute inset-y-0 left-0 bg-netflix-red" style={{ width: `${pct}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step="any"
              value={dragging ? dragValue : Math.max(0, Math.min(currentTime, duration || 0))}
              // Tracked while dragging so the thumb follows the pointer; the seek
              // itself happens on release, so scrubbing does not fire a seek per
              // pixel.
              onChange={(e) => setDragValue(Number(e.target.value))}
              onPointerUp={() => {
                if (dragValue !== null) onSeek(dragValue);
                setDragValue(null);
              }}
              onKeyUp={() => {
                if (dragValue !== null) onSeek(dragValue);
                setDragValue(null);
              }}
              onBlur={() => setDragValue(null)}
              aria-label="Seek"
              className="player-scrubber relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent"
            />
          </div>
        )}

        <div className="mt-1 flex items-center gap-3 text-white">
          <button type="button" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"} className="shrink-0 touch-manipulation">
            {isPlaying ? (
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Volume -- pointer devices only; on touch the OS handles it. */}
          <div className="hidden items-center gap-2 sm:flex">
            <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="shrink-0">
              {/* Each state's glyph is balanced within the 24-unit box rather
                  than growing rightwards off a fixed speaker. The old set
                  shared one speaker pinned at x=4 and appended waves per
                  state, so the three spanned 4-20.5, 4-15.5 and 4-23: the
                  speaker itself sat well left of centre (centre 8.5 against
                  the box's 12), which is the leftward shift, and the icon's
                  weight visibly jumped sideways as the volume crossed a
                  threshold. */}
              {muted || volume === 0 ? (
                // Muted / 0: speaker, struck through.
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                </svg>
              ) : volume < 0.5 ? (
                // Low: speaker with one sound wave.
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
                </svg>
              ) : (
                // High: speaker with two sound waves.
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
              className="player-scrubber h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/30"
            />
          </div>

          {live ? (
            /*
              A broadcast has no end, so there is no total to count towards --
              showing one is what made this look like a recording. This used
              to also show how far behind playback was and offer a button to
              jump back, which put a running countdown on screen for
              something the player now handles on its own (LivePlayer resyncs
              to the edge itself, on a stall and on resuming from a pause) --
              a status light, not a control.
            */
            <span
              className={`ml-1 flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs font-bold uppercase tracking-wide ${
                live.atLive ? "bg-netflix-red text-white" : "bg-white/15 text-white/80"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${live.atLive ? "bg-white" : "bg-white/50"}`}
                aria-hidden
              />
              Live
            </span>
          ) : (
            <span className="ml-1 text-xs tabular-nums text-white/90 sm:text-sm">
              {formatTime(currentTime)} <span className="text-white/50">/ {formatTime(duration)}</span>
            </span>
          )}

          <div className="relative ml-auto flex items-center gap-2">
            {fullscreenHint && (
              <span role="status" className="absolute bottom-full right-0 mb-2 whitespace-nowrap rounded bg-black/85 px-2.5 py-1.5 text-xs text-white shadow-lg">
                Press F11 to exit full screen
              </span>
            )}
            {extraBottomRight}
            <button type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} className="shrink-0 touch-manipulation">
              {isFullscreen ? (
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l5 5m0-5v5H4m16-5l-5 5m0-5v5h5M4 20l5-5m0 5v-5H4m16 5l-5-5m0 5v-5h5" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5v4m0-4h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
