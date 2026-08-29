"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  tryMobileNativeVideoFullscreen,
  isMobileViewport,
} from "@/lib/videoFullscreen";
import { QualitySelector, type PlaybackQuality } from "./QualitySelector";
import { VideoChrome } from "./VideoChrome";
import { usePlayerChrome } from "@/lib/usePlayerChrome";

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
};

const PROGRESS_SAVE_INTERVAL_SEC = 60;
export function WatchPlayer({
  movieId,
  movieTitle,
  backdropUrl,
  initialProgressSeconds,
  runtimeMinutes,
  autoPlay = false,
  videoUrl,
  closeHref,
}: WatchPlayerProps) {
  const hasSource = !!videoUrl;
  // Playback quality is viewer-chosen: Auto direct-plays and falls back to a
  // 1080p transcode only if the browser can't decode the source; 4K forces the
  // raw source; 1080p forces the transcode. `transcoding` is derived from that
  // choice (plus Auto's one-shot fallback) and picks the source URL.
  const [quality, setQuality] = useState<PlaybackQuality>("auto");
  // Set when a direct-play source errors (unplayable codec) and we drop to the
  // transcode. Applies to both Auto and 4K -- a watchable 1080p beats a black
  // screen. Reset whenever the viewer picks a quality.
  const [autoFellBack, setAutoFellBack] = useState(false);
  const transcoding = quality === "1080p" || autoFellBack;
  // Where the *current* transcode source begins in the movie's real timeline
  // (Jellyfin's startTimeTicks). A transcode can only be played from where
  // ffmpeg has already encoded to, so scrubbing ahead has to restart the
  // transcode at the target instead of setting currentTime on the same
  // stream -- which does nothing there, since those bytes don't exist yet.
  // Always 0 for direct play, where the whole file is one seekable source.
  const [transcodeStartAt, setTranscodeStartAt] = useState(0);
  const videoSrc = !videoUrl
    ? ""
    : transcoding
      ? `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}mode=transcode${
          transcodeStartAt > 0 ? `&t=${Math.floor(transcodeStartAt)}` : ""
        }`
      : videoUrl;
  // Absolute (real-timeline) position to resume at after a source swap --
  // quality change, Auto's codec fallback, or a transcode-seek restart.
  const resumeAtRef = useRef<number | null>(null);
  // Guards the reload effect from firing on first mount, where the initial
  // source and the saved-progress seek are handled elsewhere.
  const didSwapRef = useRef(false);
  const [playing, setPlaying] = useState(autoPlay && hasSource);
  const [showOverlay, setShowOverlay] = useState(!autoPlay || !hasSource);
  const [isMobile, setIsMobile] = useState(false);
  const router = useRouter();
  const [videoLoading, setVideoLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chrome = usePlayerChrome(videoRef, containerRef, {
    knownDurationSeconds: runtimeMinutes ? runtimeMinutes * 60 : null,
    timeOffsetSeconds: transcoding ? transcodeStartAt : 0,
    // Only wired up while transcoding -- direct play seeks for free via Range
    // requests, no restart needed.
    onExternalSeek: transcoding
      ? (absoluteSeconds: number) => {
          resumeAtRef.current = null; // the new stream starts exactly there; nothing more to seek
          didSwapRef.current = true;
          setVideoLoading(true);
          setTranscodeStartAt(Math.max(0, absoluteSeconds));
          return true;
        }
      : undefined,
  });

  // On mobile, hold at the play button instead of autoplaying. Fullscreen can
  // only be entered from a real user gesture, and arriving on this page isn't
  // one -- so autoplaying there guarantees an inline video that never
  // maximises. Making the tap the trigger is what lets it open fullscreen.
  useEffect(() => {
    if (!isMobileViewport()) return;
    setIsMobile(true);
    setPlaying(false);
    setShowOverlay(true);
  }, []);

  // Viewer picked a quality. Remember where we are (in absolute/real-timeline
  // terms -- chrome.currentTime already accounts for any transcode offset),
  // then let the derived `transcoding`/`videoSrc` change drive the reload
  // effect below.
  const changeQuality = (q: PlaybackQuality) => {
    // Re-picking the current quality is a no-op, unless we'd fallen back to a
    // transcode -- then it's a request to retry direct-play at that quality.
    if (q === quality && !autoFellBack) return;
    resumeAtRef.current = chrome.currentTime > 0 ? chrome.currentTime : null;
    didSwapRef.current = true;
    setAutoFellBack(false);
    setPlaybackError(false);
    setVideoLoading(true);
    // Switching to a transcode: start it exactly at the resume position, same
    // mechanism as a scrub-seek. Switching to direct play: no offset, the
    // resume seek happens client-side once the file is loaded (below).
    setTranscodeStartAt(q === "1080p" && resumeAtRef.current ? resumeAtRef.current : 0);
    setQuality(q);
  };

  // Any source swap (quality change, Auto's codec fallback, or a
  // transcode-seek restart) flips `transcoding` and/or `transcodeStartAt`,
  // which change the src. Force the element to load the new URL and resume --
  // changing src alone can leave a browser sitting on the media it just gave
  // up on. Wait for `canplay`, not just metadata.
  useEffect(() => {
    if (!didSwapRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    v.load();
    const onReady = () => {
      const target = resumeAtRef.current;
      resumeAtRef.current = null;
      // A transcode restart already begins at the right position (via
      // startTimeTicks) -- nothing left to seek. Only direct play needs a
      // client-side seek here, and only within what's actually seekable, so
      // an out-of-range set can't stall a partially-buffered file.
      if (target != null && !transcoding) {
        try {
          const seekable =
            v.seekable && v.seekable.length > 0
              ? target <= v.seekable.end(v.seekable.length - 1)
              : false;
          if (seekable) v.currentTime = target;
        } catch {
          /* not seekable yet; play from the stream's start instead of stalling */
        }
      }
      v.play().catch(() => {});
      setVideoLoading(false);
    };
    v.addEventListener("canplay", onReady, { once: true });
    return () => v.removeEventListener("canplay", onReady);
  }, [transcoding, transcodeStartAt]);

  // Leaving fullscreen deliberately does NOT leave the page. It used to call
  // router.back(), from a time when exiting stranded the viewer on a bare
  // inline video with no way back. The maximise button is that way back now,
  // so navigating away instead threw people out of the film for minimising --
  // and iOS fires the same event when the app is backgrounded, so pulling up
  // the home panel ejected them too. The close control handles leaving.

  useEffect(() => {
    // Mobile plays from the tap handler instead, which is the only place
    // fullscreen can actually be requested.
    if (!hasSource || !playing || !videoRef.current || isMobile) return;
    const v = videoRef.current;
    if (initialProgressSeconds > 0) v.currentTime = initialProgressSeconds;
    setVideoLoading(true);
    v.play()
      .then(() => {
        setVideoLoading(false);
        setShowOverlay(false);
      })
      .catch(() => {
        setVideoLoading(false);
        setPlaying(false);
        setShowOverlay(true);
        setPlaybackError(true);
      });
  }, [hasSource, playing, initialProgressSeconds, isMobile]);

  const handlePlayClick = () => {
    const v = videoRef.current;
    if (v) {
      setVideoLoading(true);
      setPlaybackError(false);
      // A previous attempt can leave the element in a failed state that
      // won't retry on play() alone -- reload it so a retry is a real retry
      // rather than an unresponsive-looking no-op.
      if (v.error) v.load();
      if (initialProgressSeconds > 0) v.currentTime = initialProgressSeconds;

      // Fullscreen must be requested here, synchronously inside the tap, not
      // after play() resolves: iOS only honours it while the user gesture is
      // still active, so doing it in a .then() silently no-ops and leaves the
      // video playing inline under our own chrome.
      tryMobileNativeVideoFullscreen(v);

      v.play()
        .then(() => {
          setVideoLoading(false);
          setPlaying(true);
          setShowOverlay(false);
        })
        .catch(() => {
          setVideoLoading(false);
          setPlaybackError(true);
        });
    } else {
      setPlaying(true);
      setShowOverlay(false);
    }
  };

  useEffect(() => {
    if (!playing) return;
    const v = videoRef.current;
    if (!v) return;
    let lastSaved = 0;
    const onTimeUpdate = () => {
      const sec = Math.floor(v.currentTime);
      if (sec > 0 && sec - lastSaved >= PROGRESS_SAVE_INTERVAL_SEC) {
        lastSaved = sec;
        fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ movieId, progressSeconds: sec }),
        }).catch(() => {});
      }
    };
    const onPause = () => {
      const sec = Math.floor(v.currentTime);
      if (sec > 0) {
        fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ movieId, progressSeconds: sec }),
        }).catch(() => {});
      }
    };
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("pause", onPause);
    };
  }, [playing, movieId]);

  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v && v.currentTime > 0) {
        const sec = Math.floor(v.currentTime);
        fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ movieId, progressSeconds: sec }),
        }).catch(() => {});
      }
    };
  }, [movieId]);

  const showVideo = playing && !showOverlay;
  /** Mobile: inline slot + native video fullscreen (iOS webkitEnterFullscreen, etc.). Desktop: faux fullscreen. */
  const containerClass = showVideo
    ? "relative w-full aspect-video bg-black md:fixed md:inset-0 md:z-30 md:h-screen md:w-screen md:aspect-auto"
    : "min-h-[400px] h-[60vh]";

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-black ${containerClass}`}
      onMouseMove={() => showVideo && chrome.revealControls()}
      onTouchStart={() => showVideo && chrome.revealControls()}
    >
      <video
        ref={videoRef}
        src={videoSrc}
        autoPlay
        playsInline
        // Native controls on mobile, our own chrome on desktop. iOS/Android's
        // fullscreen (entered below, on tap) only ever shows the <video>
        // element itself -- VideoChrome is a sibling <div>, so it can't render
        // inside that native surface no matter what we do; native controls are
        // the only ones that exist there. Without this, mobile fullscreen has
        // no controls at all.
        controls={isMobile}
        onClick={() => {
          if (!showVideo || isMobile) return;
          // Tap on the picture: reveal the controls if hidden, otherwise
          // play/pause -- the usual click-to-toggle once they're already up.
          if (chrome.controlsVisible) chrome.togglePlay();
          else chrome.revealControls();
        }}
        className={`absolute inset-0 w-full h-full object-contain ${showOverlay ? "invisible" : ""}`}
        aria-label={movieTitle}
        onError={() => {
          // Direct-play failed (almost always an unsupported codec). Fall back
          // to the transcode and keep playing rather than dropping to the error
          // overlay -- from either Auto or 4K. Only a failure while already
          // transcoding is a real error.
          if (hasSource && !transcoding) {
            const at = chrome.currentTime > 0 ? chrome.currentTime : null;
            resumeAtRef.current = at;
            didSwapRef.current = true;
            setTranscodeStartAt(at ?? 0);
            setAutoFellBack(true);
            setVideoLoading(true);
            return;
          }
          setPlaying(false);
          setShowOverlay(true);
          setVideoLoading(false);
          setPlaybackError(true);
        }}
        onPlay={() => {
          setShowOverlay(false);
          setPlaybackError(false);
          chrome.revealControls();
        }}
      />
      {showVideo && !isMobile && (
        <VideoChrome
          title={movieTitle}
          quality={quality}
          onQualityChange={changeQuality}
          closeHref={closeHref}
          chrome={chrome}
        />
      )}
      {/* Mobile: playing inline, before the viewer has tapped into native
          fullscreen (or after backing out of it) -- native fullscreen supplies
          its own controls, so this exists only for the inline window where it
          doesn't. Quality has to live here since native controls don't offer
          it, and it's the only view where our own DOM can render at all. */}
      {showVideo && isMobile && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
          <QualitySelector value={quality} onChange={changeQuality} />
          {closeHref && (
            <Link
              href={closeHref}
              prefetch
              aria-label="Close"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 active:bg-black/80 touch-manipulation"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Link>
          )}
        </div>
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
