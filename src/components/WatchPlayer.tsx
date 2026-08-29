"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  tryMobileNativeVideoFullscreen,
  enterNativeVideoFullscreen,
  isMobileViewport,
} from "@/lib/videoFullscreen";

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
};

const PROGRESS_SAVE_INTERVAL_SEC = 60;
const TITLE_SHOW_MS = 3000;
export function WatchPlayer({
  movieId,
  movieTitle,
  backdropUrl,
  initialProgressSeconds,
  autoPlay = false,
  videoUrl,
}: WatchPlayerProps) {
  const hasSource = !!videoUrl;
  // Direct-play first; on a codec the browser can't handle (HEVC/10-bit/4K) the
  // <video> fires onError, and we retry the same item transcoded to H.264 via
  // Jellyfin. One-way: once transcoding, a further error is a real failure.
  const [transcoding, setTranscoding] = useState(false);
  const videoSrc = !videoUrl
    ? ""
    : transcoding
      ? `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}mode=transcode`
      : videoUrl;
  const [playing, setPlaying] = useState(autoPlay && hasSource);
  const [showOverlay, setShowOverlay] = useState(!autoPlay || !hasSource);
  const [isMobile, setIsMobile] = useState(false);
  const router = useRouter();
  const [videoLoading, setVideoLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [showTitle, setShowTitle] = useState(true);
  const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const scheduleTitleHide = () => {
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
    titleTimeoutRef.current = setTimeout(() => setShowTitle(false), TITLE_SHOW_MS);
  };
  const showTitleTemporarily = () => {
    setShowTitle(true);
    scheduleTitleHide();
  };
  useEffect(() => {
    return () => {
      if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
    };
  }, []);

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

  // When we switch to the transcoded source, force the element to load the new
  // URL and resume. Changing src alone can leave a browser sitting on the
  // errored media it just gave up on.
  useEffect(() => {
    if (!transcoding) return;
    const v = videoRef.current;
    if (!v) return;
    v.load();
    v.play().catch(() => {});
  }, [transcoding]);

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
      className={`relative w-full bg-black ${containerClass}`}
      onMouseEnter={() => showVideo && showTitleTemporarily()}
      onMouseLeave={() => showVideo && scheduleTitleHide()}
    >
      {/* Our own title bar is desktop-only. In native fullscreen the OS draws
          its own controls and title, and layering ours on top is what made
          mobile feel cluttered. */}
      {showVideo && !isMobile && (
        <div
          className={`absolute top-0 left-0 right-0 z-10 px-6 py-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none transition-opacity duration-300 ${
            showTitle ? "opacity-100" : "opacity-0"
          }`}
        >
          <p className="text-white font-medium text-lg drop-shadow-md">{movieTitle}</p>
        </div>
      )}
      {/* Explicit way back to fullscreen on mobile. The tap that starts
          playback opens the native player, but once a viewer leaves it the
          video keeps playing inline with no obvious way to maximise again --
          iOS gives no control for that. Sits bottom-right, clear of the
          native transport controls along the top and centre. */}
      {showVideo && isMobile && (
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (v) enterNativeVideoFullscreen(v);
          }}
          aria-label="Maximize video"
          className="streamy-player-maximize absolute z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white active:bg-black/90 touch-manipulation"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-5v4m0-4h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"
            />
          </svg>
        </button>
      )}
      <video
        ref={videoRef}
        src={videoSrc}
        controls
        autoPlay
        playsInline
        className={`absolute inset-0 w-full h-full object-contain ${showOverlay ? "invisible" : ""}`}
        aria-label={movieTitle}
        onError={() => {
          // First failure on a source we haven't transcoded yet: almost always
          // an unsupported codec. Retry transcoded and keep playing rather than
          // dropping to the error overlay.
          if (hasSource && !transcoding) {
            setTranscoding(true);
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
          setShowTitle(true);
          setPlaybackError(false);
          scheduleTitleHide();
        }}
      />
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
