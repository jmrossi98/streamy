"use client";

import Link from "next/link";
import { formatTime } from "@/lib/usePlayerChrome";

type ChromeState = {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  muted: boolean;
  volume: number;
  isFullscreen: boolean;
  controlsVisible: boolean;
  togglePlay: () => void;
  seek: (t: number) => void;
  toggleMute: () => void;
  setVolume: (v: number) => void;
  toggleFullscreen: () => void;
};

// A single unified control overlay for both the movie and episode players.
// Replaces the native <video controls> (whose scrubber resizes during a
// transcode) plus the old scattered title/quality/maximize overlays.
export function VideoChrome({
  title,
  subtitle,
  closeHref,
  onClose,
  chrome,
  extraTopRight,
  extraBottomRight,
}: {
  title: string;
  subtitle?: string;
  closeHref?: string;
  onClose?: () => void;
  chrome: ChromeState;
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
    controlsVisible,
    togglePlay,
    seek,
    toggleMute,
    setVolume,
    toggleFullscreen,
  } = chrome;

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const show = controlsVisible || !isPlaying;
  // The root never captures pointer events -- only the bars/buttons do -- so
  // clicks on the empty middle fall through to the <video> (tap to toggle/reveal).
  const interactive = show ? "pointer-events-auto" : "pointer-events-none";

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
      {!isPlaying && (
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
        {/* Scrubber */}
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
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            className="player-scrubber relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent"
          />
        </div>

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

          <span className="ml-1 text-xs tabular-nums text-white/90 sm:text-sm">
            {formatTime(currentTime)} <span className="text-white/50">/ {formatTime(duration)}</span>
          </span>

          <div className="ml-auto flex items-center gap-2">
            {extraBottomRight}
            <button type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} className="shrink-0 touch-manipulation">
              {isFullscreen ? (
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 5V4h5m6 5l5-5m0 5V4h-5m-6 11l-5 5m0-5v5h5m6-5l5 5m0-5v5h-5" />
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
