"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { isMobileViewport } from "@/lib/videoFullscreen";
import { supportsNativeHls } from "@/lib/hlsSupport";
import type { PlaybackQuality } from "./QualitySelector";
import { VideoChrome } from "./VideoChrome";
import { SubtitleSelector, type SubtitleOption } from "./SubtitleSelector";
import { usePlayerChrome } from "@/lib/usePlayerChrome";

/** See the same helper in EpisodePlayer -- kept duplicated rather than
 * shared since it's three lines and pulling it out would mean a new module
 * just for this. */
function applySubtitleMode(v: HTMLVideoElement, tracks: SubtitleOption[], selected: number | null) {
  for (let i = 0; i < v.textTracks.length && i < tracks.length; i++) {
    v.textTracks[i].mode = tracks[i].index === selected ? "showing" : "disabled";
  }
}

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
  subtitleTracks = [],
}: WatchPlayerProps) {
  const hasSource = !!videoUrl;
  // Playback quality is viewer-chosen: Auto direct-plays and falls back to a
  // 1080p transcode only if the browser can't decode the source; 4K forces the
  // raw source; 1080p forces the transcode. `transcoding` is derived from that
  // choice (plus Auto's one-shot fallback) and picks the source URL.
  // Defaults to Auto, not 1080p. This library is mostly standard H.264/AAC
  // rips that direct-play fine, and the live-transcode delivery itself
  // (a fragmented MP4 fed straight into a plain <video src>) turned out to
  // be unreliable in real testing -- confirmed hanging indefinitely
  // (readyState never left HAVE_NOTHING) despite Jellyfin correctly
  // streaming bytes the whole time, while direct play against the exact
  // same title worked immediately. Forcing every title through that path
  // by defaulting to 1080p is what turned an occasional issue into
  // "every title fails." The real fix (routing the transcode through HLS
  // universally, via hls.js for browsers without native support) is a
  // separate, more careful follow-up -- this restores the common case now.
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
  // One id for this whole viewing, sent as Jellyfin's PlaySessionId on every
  // transcode request so a seek is recognised as "move this session", not a
  // brand new independent stream. Generated once, lazily, on first render.
  const [playSessionId] = useState(() => crypto.randomUUID());
  // Safari won't reliably start playback against the plain progressive
  // transcode endpoint (see jellyfinHlsMasterUrl) -- route it through
  // Jellyfin's HLS output there instead. Chrome/Firefox keep the simpler path.
  const [useHls] = useState(supportsNativeHls);
  const [selectedSubtitle, setSelectedSubtitle] = useState<number | null>(null);
  const videoSrc = !videoUrl
    ? ""
    : transcoding
      ? useHls
        ? `${videoUrl}/hls/master.m3u8?session=${playSessionId}${
            transcodeStartAt > 0 ? `&t=${Math.floor(transcodeStartAt)}` : ""
          }`
        : `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}mode=transcode&session=${playSessionId}${
            transcodeStartAt > 0 ? `&t=${Math.floor(transcodeStartAt)}` : ""
          }`
      : videoUrl;
  // Best-effort: tell Jellyfin to kill the ffmpeg job for the current session
  // before asking for a new position. Without this, Jellyfin can leave the
  // old encode running and just keep serving *that*, ignoring the new
  // startTimeTicks entirely -- which is what made seeking during a transcode
  // snap back to wherever the transcode first started.
  //
  // Returns the request's promise -- callers must await it before triggering
  // the new stream request (changing transcodeStartAt/quality). Firing them
  // in parallel re-introduces the exact race this exists to close: if the new
  // stream request reaches Jellyfin before the stop does, Jellyfin sees an
  // already-active session and keeps serving the old encode regardless. That
  // race doesn't fire every time -- explains why the old fire-and-forget
  // version "sometimes" still snapped back rather than always.
  const stopCurrentTranscode = () => {
    return fetch("/api/stream/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playSessionId }),
    }).catch(() => {});
  };
  // Absolute (real-timeline) position to resume at after a source swap --
  // quality change, Auto's codec fallback, or a transcode-seek restart.
  const resumeAtRef = useRef<number | null>(null);
  // Guards the reload effect from firing on first mount, where the initial
  // source and the saved-progress seek are handled elsewhere.
  const didSwapRef = useRef(false);
  const [playing, setPlaying] = useState(autoPlay && hasSource);
  const [showOverlay, setShowOverlay] = useState(!autoPlay || !hasSource);
  const [isMobile, setIsMobile] = useState(false);
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
          setVideoLoading(true);
          // Wait for the old encode to actually be torn down before asking
          // for the new position -- see stopCurrentTranscode for why racing
          // the two is what caused the "sometimes still stuck" behaviour.
          stopCurrentTranscode().finally(() => {
            didSwapRef.current = true;
            setTranscodeStartAt(Math.max(0, absoluteSeconds));
          });
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
    const resumeAt = chrome.currentTime > 0 ? chrome.currentTime : null;
    resumeAtRef.current = resumeAt;
    setAutoFellBack(false);
    setPlaybackError(false);
    setVideoLoading(true);
    const applyChange = () => {
      didSwapRef.current = true;
      // Switching to a transcode: start it exactly at the resume position,
      // same mechanism as a scrub-seek. Switching to direct play: no offset,
      // the resume seek happens client-side once the file is loaded (below).
      setTranscodeStartAt(q === "1080p" && resumeAt ? resumeAt : 0);
      setQuality(q);
    };
    // Leaving or restarting a transcode either way -- wait for the old encode
    // to actually be torn down first, same race as a scrub-seek (see
    // stopCurrentTranscode).
    if (transcoding) stopCurrentTranscode().finally(applyChange);
    else applyChange();
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
      // v.load() reset every text track back to its <track> default -- reassert
      // whichever one the viewer had picked.
      applySubtitleMode(v, subtitleTracks, selectedSubtitle);
      v.play().catch(() => {});
      setVideoLoading(false);
    };
    v.addEventListener("canplay", onReady, { once: true });
    return () => v.removeEventListener("canplay", onReady);
  }, [transcoding, transcodeStartAt, subtitleTracks, selectedSubtitle]);

  // Viewer picked a subtitle track (or turned them off).
  useEffect(() => {
    const v = videoRef.current;
    if (v) applySubtitleMode(v, subtitleTracks, selectedSubtitle);
  }, [selectedSubtitle, subtitleTracks]);

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

      // Fullscreen is opt-in via the chrome's own button (usePlayerChrome),
      // not forced here. Jumping straight to native video fullscreen used to
      // happen right at this tap -- before anything had even loaded -- and it
      // replaces the whole element with the OS's own player UI, which is why
      // our overlay (quality, subtitles) never showed on mobile at all. The
      // chrome's fullscreen button tries container fullscreen first, which
      // keeps our overlay as a sibling and visible; it only falls back to
      // native video fullscreen if that's unsupported.
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

  // The unmount cleanup below only re-creates when movieId changes, so a
  // closed-over `transcoding` would go stale the moment quality changes after
  // mount -- mirror it into a ref (via its own effect, not during render) and
  // read that instead.
  const transcodingRef = useRef(transcoding);
  useEffect(() => {
    transcodingRef.current = transcoding;
  }, [transcoding]);

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
      // Leaving the page mid-transcode would otherwise leave that ffmpeg job
      // running on the mediabox indefinitely -- nothing else ever tells
      // Jellyfin this session is done.
      if (transcodingRef.current) stopCurrentTranscode();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId]);

  const showVideo = playing && !showOverlay;
  // Fills the viewport via CSS on every size, not just desktop -- this is
  // what stands in for real fullscreen on mobile now (see handlePlayClick):
  // it keeps our own chrome on screen as a sibling of the <video>, which
  // native video fullscreen can never do.
  const containerClass = showVideo ? "fixed inset-0 z-30 h-screen w-screen bg-black" : "min-h-[400px] h-[60vh]";

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
      >
        {subtitleTracks.map((t) => (
          <track key={t.index} kind="subtitles" src={`${videoUrl}/subtitles/${t.index}`} label={t.label} />
        ))}
      </video>
      {showVideo && (
        <VideoChrome
          title={movieTitle}
          quality={quality}
          onQualityChange={changeQuality}
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
