"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { tryMobileNativeVideoFullscreen } from "@/lib/videoFullscreen";

const PLACEHOLDER_SRC =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4";

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
  const videoSrc = videoUrl || PLACEHOLDER_SRC;
  const [playing, setPlaying] = useState(autoPlay);
  const [showOverlay, setShowOverlay] = useState(!autoPlay);
  const [videoLoading, setVideoLoading] = useState(false);
  const [showNextOverlay, setShowNextOverlay] = useState(false);
  const [nextCountdown, setNextCountdown] = useState(NEXT_EPISODE_COUNTDOWN_SEC);
  const [showTitle, setShowTitle] = useState(true);
  const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const router = useRouter();

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

  useEffect(() => {
    if (!playing || !videoRef.current) return;
    const v = videoRef.current;
    if (initialProgressSeconds > 0) v.currentTime = initialProgressSeconds;
    setVideoLoading(true);
    v.play()
      .then(() => {
        setVideoLoading(false);
        setShowOverlay(false);
        tryMobileNativeVideoFullscreen(v);
      })
      .catch(() => {
        setVideoLoading(false);
        setPlaying(false);
        setShowOverlay(true);
      });
  }, [playing, initialProgressSeconds]);

  const handlePlayClick = () => {
    const v = videoRef.current;
    if (v) {
      setVideoLoading(true);
      if (initialProgressSeconds > 0) v.currentTime = initialProgressSeconds;
      v.play()
        .then(() => {
          setVideoLoading(false);
          setPlaying(true);
          setShowOverlay(false);
          tryMobileNativeVideoFullscreen(v);
        })
        .catch(() => {
          setVideoLoading(false);
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
      {showVideo && (
        <div
          className={`absolute top-0 left-0 right-0 z-10 px-6 py-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none transition-opacity duration-300 ${
            showTitle ? "opacity-100" : "opacity-0"
          }`}
        >
          <p className="text-white font-medium text-lg drop-shadow-md">
            {showName} · S{seasonNumber} E{episodeNumber} {episodeName && `· ${episodeName}`}
          </p>
        </div>
      )}
      <video
        ref={videoRef}
        src={videoSrc}
        controls
        autoPlay
        playsInline
        className={`absolute inset-0 w-full h-full object-cover ${showOverlay || showNextOverlay ? "invisible" : ""}`}
        aria-label={`${showName} - ${episodeName}`}
        onError={() => {
          setPlaying(false);
          setShowOverlay(true);
        }}
        onPlay={() => {
          setShowOverlay(false);
          setShowTitle(true);
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
          <div className="absolute inset-0 flex items-center justify-center">
            {videoLoading ? (
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
                aria-label={`Play ${showName} S${seasonNumber} E${episodeNumber}`}
              >
                <svg className="w-10 h-10 ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
