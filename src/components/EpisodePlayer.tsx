"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  tryMobileNativeVideoFullscreen,
  enterNativeVideoFullscreen,
  isMobileViewport,
} from "@/lib/videoFullscreen";
import { QualitySelector, type PlaybackQuality } from "./QualitySelector";

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
  autoPlay?: boolean;
  /** When set, show "Next episode" overlay when video ends and link to this href. */
  nextEpisodeHref?: string | null;
  nextEpisodeLabel?: string;
  videoUrl?: string | null;
};

const PROGRESS_SAVE_INTERVAL_SEC = 60;
const NEXT_EPISODE_COUNTDOWN_SEC = 15;
const TITLE_SHOW_MS = 3000;
export function EpisodePlayer({
  showId,
  showName,
  seasonNumber,
  episodeNumber,
  episodeName,
  backdropUrl,
  initialProgressSeconds,
  autoPlay = true,
  nextEpisodeHref,
  nextEpisodeLabel,
  videoUrl,
}: EpisodePlayerProps) {
  const hasSource = !!videoUrl;
  // Viewer-chosen quality: Auto direct-plays and falls back to a 1080p transcode
  // if the browser can't decode the source; 4K forces the raw source; 1080p
  // forces the transcode. See the movie player for the full rationale.
  const [quality, setQuality] = useState<PlaybackQuality>("auto");
  const [autoFellBack, setAutoFellBack] = useState(false);
  const transcoding = quality === "1080p" || autoFellBack;
  const videoSrc = !videoUrl
    ? ""
    : transcoding
      ? `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}mode=transcode`
      : videoUrl;
  const resumeAtRef = useRef<number | null>(null);
  const didSwapRef = useRef(false);
  const [playing, setPlaying] = useState(autoPlay && hasSource);
  const [showOverlay, setShowOverlay] = useState(!autoPlay || !hasSource);
  const [videoLoading, setVideoLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showNextOverlay, setShowNextOverlay] = useState(false);
  const [nextCountdown, setNextCountdown] = useState(NEXT_EPISODE_COUNTDOWN_SEC);
  const [showTitle, setShowTitle] = useState(true);
  const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const router = useRouter();

  const changeQuality = (q: PlaybackQuality) => {
    if (q === quality && !autoFellBack) return;
    const v = videoRef.current;
    resumeAtRef.current = v && v.currentTime > 0 ? v.currentTime : null;
    didSwapRef.current = true;
    setAutoFellBack(false);
    setPlaybackError(false);
    setVideoLoading(true);
    setQuality(q);
  };

  // Any source swap (quality change, or Auto's codec fallback) reloads the
  // element, seeks back to where the viewer was, and resumes.
  useEffect(() => {
    if (!didSwapRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    v.load();
    const onLoaded = () => {
      if (resumeAtRef.current != null) {
        v.currentTime = resumeAtRef.current;
        resumeAtRef.current = null;
      }
      v.play().catch(() => {});
      setVideoLoading(false);
    };
    v.addEventListener("loadedmetadata", onLoaded, { once: true });
    return () => v.removeEventListener("loadedmetadata", onLoaded);
  }, [transcoding]);

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

  // On mobile, hold at the play button rather than autoplaying. Fullscreen can
  // only be entered from a real user gesture, and opening this page isn't one,
  // so autoplaying guarantees an inline video that never maximises. Making the
  // tap the trigger is what lets it open fullscreen.
  useEffect(() => {
    if (!isMobileViewport()) return;
    setIsMobile(true);
    setPlaying(false);
    setShowOverlay(true);
  }, []);

  // Leaving fullscreen deliberately does NOT leave the page. It used to call
  // router.back(), from a time when exiting stranded the viewer on a bare
  // inline video with no way back. The maximise button is that way back now,
  // so navigating away instead threw people out of the episode for minimising --
  // and iOS fires the same event when the app is backgrounded, so pulling up
  // the home panel ejected them too. The close control handles leaving.

  useEffect(() => {
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

      // Requested synchronously inside the tap: iOS only honours fullscreen
      // while the user gesture is live, so calling it from .then() silently
      // no-ops and leaves the episode playing inline under our own chrome.
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
        fetch("/api/episode-progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            showId,
            seasonNumber,
            episodeNumber,
            progressSeconds: sec,
          }),
        }).catch(() => {});
      }
    };
    const onPause = () => {
      const sec = Math.floor(v.currentTime);
      if (sec > 0) {
        fetch("/api/episode-progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            showId,
            seasonNumber,
            episodeNumber,
            progressSeconds: sec,
          }),
        }).catch(() => {});
      }
    };
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("pause", onPause);
    };
  }, [playing, showId, seasonNumber, episodeNumber]);

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
  const containerClass = showNextOverlay
    ? "fixed inset-0 z-30 w-screen h-screen"
    : showVideo
      ? "relative w-full aspect-video bg-black md:fixed md:inset-0 md:z-30 md:h-screen md:w-screen md:aspect-auto"
      : "min-h-[400px] h-[60vh]";

  return (
    <div
      className={`relative w-full bg-black ${containerClass}`}
      onMouseEnter={() => showVideo && showTitleTemporarily()}
      onMouseLeave={() => showVideo && scheduleTitleHide()}
    >
      {/* Desktop only: in native fullscreen the OS draws its own controls
          and title, so layering ours on top is what made mobile feel busy. */}
      {showVideo && !isMobile && (
        <div
          className={`absolute top-0 left-0 right-0 z-10 flex items-start justify-between gap-4 px-6 py-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none transition-opacity duration-300 ${
            showTitle ? "opacity-100" : "opacity-0"
          }`}
        >
          <p className="text-white font-medium text-lg drop-shadow-md">
            {showName} · S{seasonNumber} E{episodeNumber} {episodeName && `· ${episodeName}`}
          </p>
          <QualitySelector value={quality} onChange={changeQuality} />
        </div>
      )}
      {/* Explicit way back to fullscreen on mobile. The tap that starts
          playback opens the native player, but once a viewer leaves it the
          episode keeps playing inline with no obvious way to maximise again --
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
      {showVideo && isMobile && (
        <div className="absolute top-3 left-1/2 z-20 -translate-x-1/2">
          <QualitySelector value={quality} onChange={changeQuality} />
        </div>
      )}
      <video
        ref={videoRef}
        src={videoSrc}
        controls
        autoPlay
        playsInline
        className={`absolute inset-0 w-full h-full object-contain ${showOverlay || showNextOverlay ? "invisible" : ""}`}
        aria-label={`${showName} - ${episodeName}`}
        onError={() => {
          if (hasSource && !transcoding) {
            resumeAtRef.current = videoRef.current?.currentTime || null;
            didSwapRef.current = true;
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
          setShowTitle(true);
          setPlaybackError(false);
          scheduleTitleHide();
        }}
        onEnded={() => {
          if (nextEpisodeHref) setShowNextOverlay(true);
        }}
      />
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
