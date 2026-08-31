"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VideoChrome } from "./VideoChrome";
import { SubtitleSelector, type SubtitleOption } from "./SubtitleSelector";
import { usePlayerEngine } from "@/lib/usePlayerEngine";

// No placeholder fallback on purpose: without a real file this used to play
// an unrelated sample video, which reads as "the episode is here" when it
// isn't. An episode with no source now refuses to play and says why.

type EpisodePlayerProps = {
  showId: string;
  showName: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string;
  backdropUrl: string;
  initialProgressSeconds: number;
  runtimeMinutes?: number | null;
  autoPlay?: boolean;
  /** When set, show "Next episode" overlay when video ends and link to this href. */
  nextEpisodeHref?: string | null;
  nextEpisodeLabel?: string;
  videoUrl?: string | null;
  closeHref?: string;
  onClose?: () => void;
  /** Subtitle tracks Jellyfin already has for this episode -- omitted (or empty) hides the control entirely. */
  subtitleTracks?: SubtitleOption[];
  /** Skip straight to the transcode instead of attempting direct play first
   * -- see the movie player's WatchPlayerProps for the full rationale. */
  forceTranscode?: boolean;
};

const NEXT_EPISODE_COUNTDOWN_SEC = 15;

export function EpisodePlayer({
  showId,
  showName,
  seasonNumber,
  episodeNumber,
  episodeName,
  backdropUrl,
  initialProgressSeconds,
  runtimeMinutes,
  autoPlay = true,
  nextEpisodeHref,
  nextEpisodeLabel,
  videoUrl,
  closeHref,
  onClose,
  subtitleTracks = [],
  forceTranscode = false,
}: EpisodePlayerProps) {
  const router = useRouter();
  const [showNextOverlay, setShowNextOverlay] = useState(false);
  const [nextCountdown, setNextCountdown] = useState(NEXT_EPISODE_COUNTDOWN_SEC);

  // Stable across renders (see usePlayerEngine's saveProgress doc).
  const saveProgress = useCallback((sec: number) => {
    fetch("/api/episode-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId, seasonNumber, episodeNumber, progressSeconds: sec }),
    }).catch(() => {});
  }, [showId, seasonNumber, episodeNumber]);

  const {
    hasSource,
    selectedSubtitle,
    setSelectedSubtitle,
    playing,
    showOverlay,
    videoLoading,
    buffering,
    playbackError,
    needsHlsJs,
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
    runtimeMinutes,
    autoPlay,
    forceTranscode,
    subtitleTracks,
    identityKey: `${showId}-${seasonNumber}-${episodeNumber}`,
    saveProgress,
  });

  useEffect(() => {
    if (!showNextOverlay || !nextEpisodeHref) return;
    const t = setInterval(() => {
      setNextCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [showNextOverlay, nextEpisodeHref]);

  useEffect(() => {
    if (showNextOverlay && nextEpisodeHref && nextCountdown === 0) {
      router.push(nextEpisodeHref);
    }
  }, [showNextOverlay, nextEpisodeHref, nextCountdown, router]);

  const showVideo = playing && !showOverlay && !showNextOverlay;

  return (
    <div
      ref={containerRef}
      // Fixed full-viewport always, not just once playback starts -- both
      // callers (the standalone episode watch page and ShowContent's
      // click-to-play overlay) use this as the whole screen, never as an
      // inline preview embedded in more page. A pre-play "min-h-[400px]
      // h-[60vh]" placeholder size used to apply here, which put the play
      // button/spinner in a small box pinned near the top of the page
      // instead of centered in it -- there's nothing below it to make the
      // smaller size meaningful, just empty background (in the overlay
      // case, empty background stacked on top of the show page underneath).
      // inset-0 alone (no h-screen/w-screen) is deliberate -- those are a
      // static 100vh/100vw snapshot, and mobile browsers resize the *real*
      // viewport as their address bar collapses/expands, which is what left
      // the scrubber and expand button sitting below the visible fold on
      // first load.
      //
      // fixed/inset-0 ONLY -- no relative, no w-full. Tailwind's own
      // generated stylesheet orders the position utilities as static, fixed,
      // absolute, relative, sticky, so a `relative` class alongside `fixed`
      // on the same element wins the cascade regardless of which comes first
      // in the class string -- position collapses back to relative, inset-0
      // becomes a no-op (it only affects absolute/fixed/sticky), and with no
      // explicit height and every child absolutely positioned (nothing left
      // to size the box from), the whole element collapsed to ~0px tall,
      // pinned at the top of the page -- exactly the "clipped to top center"
      // regression this introduced. `fixed` alone already establishes a
      // positioning context for the absolutely-positioned children, so
      // `relative` was never actually needed here.
      className="bg-black fixed inset-0 z-30"
      onMouseMove={() => showVideo && chrome.revealControls()}
      onTouchStart={() => showVideo && chrome.revealControls()}
    >
      <video
        ref={videoRef}
        // hls.js feeds the element itself via MSE -- setting src too would
        // fight it. Every other case (direct play, native Safari HLS) uses
        // the attribute normally.
        src={needsHlsJs ? undefined : videoSrc}
        autoPlay={!needsHlsJs}
        playsInline
        controls={false}
        onClick={() => {
          if (!showVideo) return;
          if (chrome.controlsVisible) chrome.togglePlay();
          else chrome.revealControls();
        }}
        className={`absolute inset-0 w-full h-full object-contain ${showOverlay || showNextOverlay ? "invisible" : ""}`}
        aria-label={`${showName} - ${episodeName}`}
        onError={onVideoError}
        onPlay={onVideoPlay}
        onEnded={() => {
          if (nextEpisodeHref) setShowNextOverlay(true);
        }}
      >
        {subtitleTracks.map((t) => (
          <track key={t.index} kind="subtitles" src={`${videoUrl}/subtitles/${t.index}`} label={t.label} />
        ))}
      </video>
      {showVideo && buffering && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span
            className="h-14 w-14 rounded-full border-4 border-white/25 border-t-white animate-spin"
            aria-label="Buffering"
          />
        </div>
      )}
      {showVideo && (
        <VideoChrome
          title={showName}
          subtitle={`S${seasonNumber} E${episodeNumber}${episodeName ? ` · ${episodeName}` : ""}`}
          closeHref={closeHref}
          onClose={onClose}
          chrome={chrome}
          extraTopRight={
            subtitleTracks.length > 0 ? (
              <SubtitleSelector tracks={subtitleTracks} value={selectedSubtitle} onChange={setSelectedSubtitle} />
            ) : undefined
          }
          extraBottomRight={
            nextEpisodeHref ? (
              <Link
                href={nextEpisodeHref}
                prefetch
                title={nextEpisodeLabel ? `Next: ${nextEpisodeLabel}` : "Next episode"}
                aria-label={nextEpisodeLabel ? `Next episode: ${nextEpisodeLabel}` : "Next episode"}
                className="shrink-0 touch-manipulation"
              >
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 5v14l8.5-7L6 5zm10 0v14h2V5h-2z" />
                </svg>
              </Link>
            ) : undefined
          }
        />
      )}
      {showNextOverlay && nextEpisodeHref && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80">
          <p className="text-white text-lg mb-2">Next episode</p>
          {nextEpisodeLabel && (
            <p className="text-white/80 text-sm mb-4">{nextEpisodeLabel}</p>
          )}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setShowNextOverlay(false)}
              className="px-4 py-2 rounded bg-white/20 text-white hover:bg-white/30"
            >
              Cancel
            </button>
            <Link
              href={nextEpisodeHref}
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-netflix-black font-semibold rounded hover:bg-white/90"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play next
              {nextCountdown > 0 && (
                <span className="text-sm opacity-80">({nextCountdown}s)</span>
              )}
            </Link>
          </div>
        </div>
      )}
      {showOverlay && !showNextOverlay && (
        <>
          <Image
            src={backdropUrl}
            alt=""
            fill
            className="object-cover"
            sizes="100vw"
          />
          <div className="hero-overlay absolute inset-0" />
          {(closeHref || onClose) && (
            closeHref ? (
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
            ) : (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute top-[calc(0.75rem+env(safe-area-inset-top,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 active:bg-black/80 touch-manipulation"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            {!hasSource ? (
              <div className="z-10 flex max-w-sm flex-col items-center gap-2 px-6 text-center">
                <svg
                  className="h-10 w-10 text-white/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
                <p className="text-white font-medium">Not downloaded yet</p>
                <p className="text-sm text-white/60">
                  S{seasonNumber} E{episodeNumber} isn&apos;t on the server. Download it from the
                  episode list, then play it here.
                </p>
              </div>
            ) : videoLoading ? (
              <div
                className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center shadow-xl z-10"
                aria-label="Loading"
              >
                <span className="w-10 h-10 rounded-full border-2 border-netflix-black/30 border-t-netflix-black animate-spin" />
              </div>
            ) : (
              <button
                type="button"
                onClick={handlePlayClick}
                className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center text-netflix-black hover:bg-white transition-colors shadow-xl z-10"
                aria-label={`${playbackError ? "Retry" : "Play"} ${showName} S${seasonNumber} E${episodeNumber}`}
              >
                <svg className="w-10 h-10 ml-1" fill="currentColor" viewBox="0 0 24 24">
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
