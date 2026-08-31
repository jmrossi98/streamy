"use client";

import { useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { VideoChrome } from "./VideoChrome";
import { SubtitleSelector, type SubtitleOption } from "./SubtitleSelector";
import { usePlayerEngine } from "@/lib/usePlayerEngine";

// No placeholder fallback on purpose: without a real file this used to play
// an unrelated sample video, which reads as "the movie is here" when it
// isn't. A title with no source now refuses to play and says why.

type WatchPlayerProps = {
  movieId: string;
  movieTitle: string;
  backdropUrl: string;
  initialProgressSeconds: number;
  runtimeMinutes: number | null;
  autoPlay?: boolean;
  videoUrl?: string | null;
  closeHref?: string;
  /** Subtitle tracks Jellyfin already has for this movie -- omitted (or empty) hides the control entirely. */
  subtitleTracks?: SubtitleOption[];
  /** Skip straight to the transcode instead of attempting direct play first
   * -- set when the file's own audio codec is one direct play silently
   * fails on (AC3/DTS/TrueHD/EAC3; see needsForcedTranscode). Those don't
   * throw an error direct play's normal fallback can react to -- the
   * browser just plays picture with no sound and never says anything's
   * wrong -- so there's nothing to catch after the fact. */
  forceTranscode?: boolean;
};

export function WatchPlayer({
  movieId,
  movieTitle,
  backdropUrl,
  initialProgressSeconds,
  runtimeMinutes,
  autoPlay = false,
  videoUrl,
  closeHref,
  subtitleTracks = [],
  forceTranscode = false,
}: WatchPlayerProps) {
  // Stable across renders (see usePlayerEngine's saveProgress doc) --
  // movieId is the only thing this closes over, and that's a prop.
  const saveProgress = useCallback((sec: number) => {
    fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movieId, progressSeconds: sec }),
    }).catch(() => {});
  }, [movieId]);

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
    identityKey: movieId,
    saveProgress,
  });

  const showVideo = playing && !showOverlay;

  return (
    <div
      ref={containerRef}
      // Fixed full-viewport always, not just once playback starts -- the
      // only caller, /watch/[id]/play, is a dedicated full-page watch route
      // with nothing else on it, never an inline preview embedded in more
      // page. A pre-play "min-h-[400px] h-[60vh]" placeholder size used to
      // apply here, which put the play button/spinner in a small box pinned
      // near the top of the page instead of centered in it -- there's
      // nothing below it to make the smaller size meaningful, just empty
      // background. inset-0 alone (no h-screen/w-screen) is deliberate --
      // those are a static 100vh/100vw snapshot, and mobile browsers resize
      // the *real* viewport as their address bar collapses/expands, which is
      // what left the scrubber and expand button sitting below the visible
      // fold on first load.
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
          // Tap on the picture: reveal the controls if hidden, otherwise
          // play/pause -- the usual click-to-toggle once they're already up.
          if (chrome.controlsVisible) chrome.togglePlay();
          else chrome.revealControls();
        }}
        className={`absolute inset-0 w-full h-full object-contain ${showOverlay ? "invisible" : ""}`}
        aria-label={movieTitle}
        onError={onVideoError}
        onPlay={onVideoPlay}
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
          title={movieTitle}
          closeHref={closeHref}
          chrome={chrome}
          extraTopRight={
            subtitleTracks.length > 0 ? (
              <SubtitleSelector tracks={subtitleTracks} value={selectedSubtitle} onChange={setSelectedSubtitle} />
            ) : undefined
          }
        />
      )}
      {showOverlay && (
        <>
          <Image
            src={backdropUrl}
            alt=""
            fill
            className="object-cover"
            sizes="100vw"
          />
          <div className="hero-overlay absolute inset-0" />
          {closeHref && (
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
                  {movieTitle} isn&apos;t on the server yet. Download it first, then play it here.
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
                aria-label={playbackError ? `Retry ${movieTitle}` : `Play ${movieTitle}`}
              >
                <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
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
