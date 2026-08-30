"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Hls from "hls.js";
import { isMobileViewport } from "@/lib/videoFullscreen";
import { supportsNativeHls } from "@/lib/hlsSupport";
import type { PlaybackQuality } from "./QualitySelector";
import { VideoChrome } from "./VideoChrome";
import { SubtitleSelector, type SubtitleOption } from "./SubtitleSelector";
import { usePlayerChrome } from "@/lib/usePlayerChrome";

/** Applies the viewer's subtitle choice to the <video>'s live text tracks --
 * called on selection and again after every reload (v.load() resets track
 * modes back to whatever the <track> attributes said). Matched positionally:
 * textTracks[i] corresponds to the i-th rendered <track>. */
function applySubtitleMode(v: HTMLVideoElement, tracks: SubtitleOption[], selected: number | null) {
  for (let i = 0; i < v.textTracks.length && i < tracks.length; i++) {
    v.textTracks[i].mode = tracks[i].index === selected ? "showing" : "disabled";
  }
}

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
};

const PROGRESS_SAVE_INTERVAL_SEC = 60;
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
}: EpisodePlayerProps) {
  const hasSource = !!videoUrl;
  // Viewer-chosen quality: Auto direct-plays and falls back to a 1080p transcode
  // if the browser can't decode the source; 4K forces the raw source; 1080p
  // forces the transcode. Defaults to Auto, not 1080p -- see the movie player
  // for the full rationale (the live-transcode delivery path itself turned
  // out to be unreliable; defaulting everyone through it broke playback
  // broadly, where direct play against the same titles works fine).
  const [quality, setQuality] = useState<PlaybackQuality>("auto");
  const [autoFellBack, setAutoFellBack] = useState(false);
  const transcoding = quality === "1080p" || autoFellBack;
  // Where the current transcode source begins in the episode's real timeline
  // (Jellyfin's startTimeTicks). See the movie player for the full rationale --
  // a transcode can only be played from where ffmpeg has already encoded to,
  // so a scrub-seek has to restart the transcode at the target instead of
  // setting currentTime, which does nothing on a progressive stream.
  // Initialised from the saved position, not 0 -- see the movie player for
  // the full rationale (a resume straight into a forced transcode should
  // start where the viewer left off, same as a scrub-seek). Harmless for
  // direct play, which never reads it.
  const [transcodeStartAt, setTranscodeStartAt] = useState(initialProgressSeconds);
  const [playSessionId] = useState(() => crypto.randomUUID());
  // A transcode is always delivered as HLS now, not a plain progressive MP4
  // -- see the movie player for the full rationale (that path turned out to
  // hang indefinitely in the browser despite Jellyfin streaming real bytes
  // correctly the whole time). Native for Safari, hls.js for everyone else.
  const [nativeHlsSupport] = useState(supportsNativeHls);
  const needsHlsJs = transcoding && !nativeHlsSupport;
  const hlsRef = useRef<Hls | null>(null);
  const [selectedSubtitle, setSelectedSubtitle] = useState<number | null>(null);
  const videoSrc = !videoUrl
    ? ""
    : transcoding
      ? `${videoUrl}/hls/master.m3u8?session=${playSessionId}${
          transcodeStartAt > 0 ? `&t=${Math.floor(transcodeStartAt)}` : ""
        }`
      : videoUrl;
  // Best-effort: see the movie player for why this has to happen before
  // asking Jellyfin for a new position during an active transcode. Returns
  // the request's promise -- callers must await it before triggering the new
  // stream request, or the new request can race ahead of the old encode's
  // teardown and Jellyfin just keeps serving the old one (see the movie
  // player for the full rationale -- this is what caused "sometimes still
  // stuck" rather than "always stuck").
  const stopCurrentTranscode = () => {
    return fetch("/api/stream/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playSessionId }),
    }).catch(() => {});
  };
  const resumeAtRef = useRef<number | null>(null);
  const didSwapRef = useRef(false);
  const [playing, setPlaying] = useState(autoPlay && hasSource);
  const [showOverlay, setShowOverlay] = useState(!autoPlay || !hasSource);
  const [videoLoading, setVideoLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showNextOverlay, setShowNextOverlay] = useState(false);
  const [nextCountdown, setNextCountdown] = useState(NEXT_EPISODE_COUNTDOWN_SEC);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chrome = usePlayerChrome(videoRef, containerRef, {
    knownDurationSeconds: runtimeMinutes ? runtimeMinutes * 60 : null,
    timeOffsetSeconds: transcoding ? transcodeStartAt : 0,
    onExternalSeek: transcoding
      ? (absoluteSeconds: number) => {
          resumeAtRef.current = null;
          setVideoLoading(true);
          stopCurrentTranscode().finally(() => {
            didSwapRef.current = true;
            setTranscodeStartAt(Math.max(0, absoluteSeconds));
          });
          return true;
        }
      : undefined,
  });
  const router = useRouter();

  // Leaving mid-transcode (navigating to the next episode, closing the
  // player) would otherwise leave that ffmpeg job running on the mediabox
  // indefinitely -- nothing else ever tells Jellyfin this session is done.
  // Read through a ref since this only re-creates when the episode identity
  // changes, so a closed-over `transcoding` would go stale the moment
  // quality changes after mount.
  const transcodingRef = useRef(transcoding);
  useEffect(() => {
    transcodingRef.current = transcoding;
  }, [transcoding]);
  useEffect(() => {
    return () => {
      if (transcodingRef.current) stopCurrentTranscode();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId, seasonNumber, episodeNumber]);

  const changeQuality = (q: PlaybackQuality) => {
    if (q === quality && !autoFellBack) return;
    const resumeAt = chrome.currentTime > 0 ? chrome.currentTime : null;
    resumeAtRef.current = resumeAt;
    setAutoFellBack(false);
    setPlaybackError(false);
    setVideoLoading(true);
    const applyChange = () => {
      didSwapRef.current = true;
      setTranscodeStartAt(q === "1080p" && resumeAt ? resumeAt : 0);
      setQuality(q);
    };
    // Wait for the old encode to actually be torn down first -- same race as
    // a scrub-seek (see stopCurrentTranscode).
    if (transcoding) stopCurrentTranscode().finally(applyChange);
    else applyChange();
  };

  // Feeds an HLS transcode into the video element via MSE for every browser
  // without native HLS support -- see the movie player for the full
  // rationale and needsHlsJs above. Runs on mount too, not just later swaps:
  // a resumed episode where Auto had fallen back before, or 1080p picked
  // directly, can already be in the hls.js state on the very first render.
  // Placed before the reload effect below so its teardown/recreate happens
  // first on a shared dependency change.
  useEffect(() => {
    if (!needsHlsJs || !videoSrc) return;
    const v = videoRef.current;
    if (!v) return;
    if (!Hls.isSupported()) {
      setVideoLoading(false);
      setPlaybackError(true);
      return;
    }
    const hls = new Hls();
    hlsRef.current = hls;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      setPlaying(false);
      setShowOverlay(true);
      setVideoLoading(false);
      setPlaybackError(true);
    });
    hls.loadSource(videoSrc);
    hls.attachMedia(v);
    return () => {
      hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
  }, [needsHlsJs, videoSrc]);

  // Any source swap (quality change, Auto's codec fallback, or a
  // transcode-seek restart) reloads the element and resumes. Wait for
  // `canplay`, not just metadata.
  //
  // Skips v.load() when hls.js owns the element (needsHlsJs) -- the effect
  // above already tears down and recreates the hls.js instance on the same
  // videoSrc change.
  useEffect(() => {
    if (!didSwapRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    if (!needsHlsJs) v.load();
    const onReady = () => {
      const target = resumeAtRef.current;
      resumeAtRef.current = null;
      // A transcode restart already begins at the right position -- only
      // direct play needs a client-side seek, and only within what's actually
      // seekable, so an out-of-range set can't stall a partial file.
      if (target != null && !transcoding) {
        try {
          const seekable =
            v.seekable && v.seekable.length > 0
              ? target <= v.seekable.end(v.seekable.length - 1)
              : false;
          if (seekable) v.currentTime = target;
        } catch {
          /* not seekable yet; play from start rather than stall */
        }
      }
      // v.load() reset every text track back to its <track> default -- reassert
      // whichever one the viewer had picked.
      applySubtitleMode(v, subtitleTracks, selectedSubtitle);
      v.play().catch(() => {});
      setVideoLoading(false);
    };
    v.addEventListener("canplay", onReady, { once: true });
    return () => v.removeEventListener("canplay", onReady);
  }, [transcoding, transcodeStartAt, subtitleTracks, selectedSubtitle, needsHlsJs]);

  // Viewer picked a subtitle track (or turned them off).
  useEffect(() => {
    const v = videoRef.current;
    if (v) applySubtitleMode(v, subtitleTracks, selectedSubtitle);
  }, [selectedSubtitle, subtitleTracks]);

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
    setVideoLoading(true);
    const doPlay = () => {
      // Only direct play needs a client-side seek -- a transcode already
      // begins at transcodeStartAt (initialised from this same value), via
      // the URL, same as a scrub-seek.
      if (initialProgressSeconds > 0 && !transcoding) v.currentTime = initialProgressSeconds;
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
    };
    if (needsHlsJs) {
      // hls.js needs a moment to fetch and parse the manifest before play()
      // can succeed -- firing immediately would just reject every time.
      v.addEventListener("canplay", doPlay, { once: true });
      return () => v.removeEventListener("canplay", doPlay);
    }
    doPlay();
  }, [hasSource, playing, initialProgressSeconds, isMobile, needsHlsJs, transcoding]);

  const handlePlayClick = () => {
    const v = videoRef.current;
    if (v) {
      setVideoLoading(true);
      setPlaybackError(false);
      const doPlay = () => {
        if (initialProgressSeconds > 0 && !transcoding) v.currentTime = initialProgressSeconds;
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
      };

      // Fullscreen is opt-in via the chrome's own button (usePlayerChrome),
      // not forced here. Jumping straight to native video fullscreen used to
      // happen right at this tap -- before anything had even loaded -- and it
      // replaces the whole element with the OS's own player UI, which is why
      // our overlay (quality, subtitles, next-episode) never showed on
      // mobile at all. The chrome's fullscreen button tries container
      // fullscreen first, which keeps our overlay as a sibling and visible;
      // it only falls back to native video fullscreen if that's unsupported.
      if (needsHlsJs) {
        if (v.readyState >= 3) doPlay();
        else v.addEventListener("canplay", doPlay, { once: true });
      } else {
        // A previous attempt can leave the element in a failed state that
        // won't retry on play() alone -- reload it so a retry is a real
        // retry rather than an unresponsive-looking no-op.
        if (v.error) v.load();
        doPlay();
      }
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
  // Fills the viewport via CSS on every size, not just desktop -- this is
  // what stands in for real fullscreen on mobile now (see handlePlayClick):
  // it keeps our own chrome on screen as a sibling of the <video>, which
  // native video fullscreen can never do.
  const containerClass = showNextOverlay
    ? "fixed inset-0 z-30 w-screen h-screen"
    : showVideo
      ? "fixed inset-0 z-30 h-screen w-screen bg-black"
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
        // hls.js feeds the element itself via MSE (see the hls.js-management
        // effect) -- setting src too would fight it. Every other case (direct
        // play, native Safari HLS) uses the attribute normally.
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
        onError={() => {
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
        onEnded={() => {
          if (nextEpisodeHref) setShowNextOverlay(true);
        }}
      >
        {subtitleTracks.map((t) => (
          <track key={t.index} kind="subtitles" src={`${videoUrl}/subtitles/${t.index}`} label={t.label} />
        ))}
      </video>
      {showVideo && (
        <VideoChrome
          title={showName}
          subtitle={`S${seasonNumber} E${episodeNumber}${episodeName ? ` · ${episodeName}` : ""}`}
          quality={quality}
          onQualityChange={changeQuality}
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
