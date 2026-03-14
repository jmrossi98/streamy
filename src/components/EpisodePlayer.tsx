"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

const VIDEO_SRC =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

type EpisodePlayerProps = {
  showId: string;
  showName: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string;
  backdropUrl: string;
  initialProgressSeconds: number;
};

const PROGRESS_SAVE_INTERVAL_SEC = 60;

export function EpisodePlayer({
  showId,
  showName,
  seasonNumber,
  episodeNumber,
  episodeName,
  backdropUrl,
  initialProgressSeconds,
}: EpisodePlayerProps) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!playing || !videoRef.current) return;
    const v = videoRef.current;
    if (initialProgressSeconds > 0) v.currentTime = initialProgressSeconds;
  }, [playing, initialProgressSeconds]);

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

  return (
    <div
      className={`relative w-full bg-black ${playing ? "min-h-[calc(100vh-4rem)]" : "min-h-[400px] h-[60vh]"}`}
    >
      {playing ? (
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          controls
          autoPlay
          playsInline
          className="w-full h-full min-h-[calc(100vh-4rem)] object-contain"
          aria-label={`${showName} - ${episodeName}`}
        />
      ) : (
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
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center text-netflix-black hover:bg-white transition-colors shadow-xl z-10"
              aria-label={`Play ${showName} S${seasonNumber} E${episodeNumber}`}
            >
              <svg className="w-10 h-10 ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
