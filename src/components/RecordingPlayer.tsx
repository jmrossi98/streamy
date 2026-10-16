"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { VideoChrome } from "./VideoChrome";
import { usePlayerEngine } from "@/lib/usePlayerEngine";

type Props = {
  eventId: number;
  /** "Washington Capitals vs Montreal Canadiens" */
  title: string;
  /** "NHL · Oct 14" */
  subtitle: string;
  videoUrl: string | null;
  closeHref: string;
  forceTranscode?: boolean;
};

/**
 * The player for a game recording. The movie and episode players each carry
 * a title type's progress plumbing (Jellyfin-synced resume, next episode,
 * subtitle and audio menus); a replay needs none of that, so this is the
 * same engine and chrome with the resume point kept in this browser only.
 * Nothing is written to the database for a replay, and no "next episode"
 * exists for one.
 */
export function RecordingPlayer({ eventId, title, subtitle, videoUrl, closeHref, forceTranscode = false }: Props) {
  const storageKey = `recording-progress:${eventId}`;
  // Read once at mount. Only the video's start position depends on it, so
  // a server render that has no localStorage draws the same markup.
  const [initialProgressSeconds] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  });

  const saveProgress = useCallback(
    (sec: number) => {
      try {
        window.localStorage.setItem(storageKey, String(Math.floor(sec)));
      } catch {
        // Private mode or blocked storage: the replay still plays.
      }
    },
    [storageKey]
  );

  const {
    hasSource,
    playing,
    showOverlay,
    videoLoading,
    buffering,
    playbackError,
    needsHlsJs,
    transcoding,
    videoSrc,
    videoRef,
    containerRef,
    chrome,
    handlePlayClick,
    onVideoError,
    onVideoPlay,
  } = usePlayerEngine({
    videoUrl,
    initialProgressSeconds,
    autoPlay: true,
    forceTranscode,
    subtitleTracks: [],
    identityKey: `recording-${eventId}`,
    saveProgress,
  });

  const showVideo = playing && !showOverlay;

  return (
    <div
      ref={containerRef}
      // fixed/inset-0 only -- see EpisodePlayer for why nothing else goes here.
      className="bg-black fixed inset-0 z-30"
      onMouseMove={() => showVideo && chrome.revealControls()}
      onTouchStart={() => showVideo && chrome.revealControls()}
    >
      <video
        ref={videoRef}
        src={needsHlsJs || !videoSrc ? undefined : videoSrc}
        autoPlay={!needsHlsJs}
        playsInline
        controls={false}
        onClick={() => {
          if (!showVideo) return;
          if (chrome.controlsVisible) chrome.togglePlay();
          else chrome.revealControls();
        }}
        className={`absolute inset-0 w-full h-full object-contain ${showOverlay ? "invisible" : ""}`}
        aria-label={title}
        onError={onVideoError}
        onPlay={onVideoPlay}
      />
      {showVideo && buffering && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="h-14 w-14 rounded-full border-4 border-white/25 border-t-white animate-spin" aria-label="Buffering" />
        </div>
      )}
      {showVideo && (
        <VideoChrome
          title={title}
          subtitle={subtitle}
          closeHref={closeHref}
          chrome={chrome}
          busy={buffering}
          previewSrc={transcoding ? null : videoUrl}
        />
      )}
      {showOverlay && (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-netflix-dark to-black" />
          <Link
            href={closeHref}
            prefetch
            aria-label="Close"
            className="absolute top-[calc(0.75rem+env(safe-area-inset-top,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 active:bg-black/80 touch-manipulation"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Link>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="z-10 px-6 text-center">
              <p className="text-xs font-bold uppercase tracking-wide text-white/50">{subtitle}</p>
              <p className="mt-1 text-lg font-semibold text-white">{title}</p>
            </div>
            {!hasSource ? (
              <div className="z-10 flex max-w-sm flex-col items-center gap-2 px-6 text-center">
                <p className="font-medium text-white">Not ready to watch yet</p>
                <p className="text-sm text-white/60">
                  Jellyfin hasn&apos;t picked this recording up yet. Give it a minute, then try again.
                </p>
              </div>
            ) : videoLoading ? (
              <div className="z-10 flex h-20 w-20 items-center justify-center rounded-full bg-white/90 shadow-xl" aria-label="Loading">
                <span className="h-10 w-10 animate-spin rounded-full border-2 border-netflix-black/30 border-t-netflix-black" />
              </div>
            ) : (
              <button
                type="button"
                onClick={handlePlayClick}
                className="z-10 flex h-20 w-20 items-center justify-center rounded-full bg-white/90 text-netflix-black shadow-xl transition-colors hover:bg-white"
                aria-label={`${playbackError ? "Retry" : "Play"} ${title}`}
              >
                <svg className="ml-1 h-10 w-10" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            )}
            {playbackError && !videoLoading && (
              <p className="z-10 max-w-xs text-center text-sm text-white/80 drop-shadow">
                Couldn&apos;t start playback. Tap to try again.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
