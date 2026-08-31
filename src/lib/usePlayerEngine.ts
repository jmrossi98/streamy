"use client";

import { useState, useRef, useEffect, type RefObject } from "react";
import Hls from "hls.js";
import { isMobileViewport } from "./videoFullscreen";
import { supportsNativeHls } from "./hlsSupport";
import { usePlayerChrome } from "./usePlayerChrome";
import type { SubtitleOption } from "@/components/SubtitleSelector";

/**
 * Everything a title-playing page needs beyond "load a URL into a <video>":
 * direct-play-with-transcode-fallback, HLS/hls.js for the transcode,
 * subtitles, resume-on-load, mobile autoplay handling, and a buffering
 * indicator. WatchPlayer (movies) and EpisodePlayer (episodes) were two
 * ~650-line files that duplicated all of this -- every fix made today had to
 * be mirrored by hand across both, which is exactly the kind of thing that
 * silently drifts. What's genuinely different between them (next-episode
 * countdown, which endpoint progress gets saved to, title/subtitle text,
 * onClose vs a bare closeHref) stays in each component; this hook is
 * everything else, written once.
 */

/** Applies the viewer's subtitle choice to the <video>'s live text tracks --
 * called on selection and again after every reload (v.load() resets track
 * modes back to whatever the <track> attributes said). Matched positionally:
 * textTracks[i] corresponds to the i-th rendered <track>. */
function applySubtitleMode(v: HTMLVideoElement, tracks: SubtitleOption[], selected: number | null) {
  for (let i = 0; i < v.textTracks.length && i < tracks.length; i++) {
    v.textTracks[i].mode = tracks[i].index === selected ? "showing" : "disabled";
  }
}

/** Setting currentTime before the browser has any metadata (readyState 0)
 * can stall a fresh load entirely rather than just being ignored/queued --
 * confirmed live, a resumed title's Play/Retry button reliably stuck at
 * HAVE_NOTHING. Wait for loadedmetadata first, the same way the
 * reload-on-swap effect already waits for canplay before its own seek. */
function seekThenRun(v: HTMLVideoElement, target: number, then: () => void) {
  if (v.readyState >= 1) {
    v.currentTime = target;
    then();
    return;
  }
  v.addEventListener(
    "loadedmetadata",
    () => {
      v.currentTime = target;
      then();
    },
    { once: true }
  );
}

const PROGRESS_SAVE_INTERVAL_SEC = 60;

export type PlayerEngineOptions = {
  videoUrl?: string | null;
  initialProgressSeconds: number;
  runtimeMinutes?: number | null;
  autoPlay: boolean;
  /** Skip straight to the transcode instead of attempting direct play first
   * -- set when the file's own audio codec is one direct play silently
   * fails on (AC3/DTS/TrueHD/EAC3). Those don't throw an error direct
   * play's normal fallback can react to -- the browser just plays picture
   * with no sound and never says anything's wrong. */
  forceTranscode?: boolean;
  subtitleTracks: SubtitleOption[];
  /** Stable identity for "the thing being played" -- a movieId, or
   * `${showId}-${season}-${episode}`. Only used as an effect dependency, to
   * re-run the unmount cleanup when the viewer moves to a different title
   * rather than just re-rendering the same one. */
  identityKey: string;
  /** Persists watch progress -- fire-and-forget, whatever endpoint/payload
   * shape the caller's title type uses. Must be referentially stable
   * (wrap in useCallback) or the progress-tracking effect resubscribes on
   * every render. */
  saveProgress: (seconds: number) => void;
};

export function usePlayerEngine(opts: PlayerEngineOptions) {
  const { videoUrl, initialProgressSeconds, runtimeMinutes, autoPlay, forceTranscode = false, subtitleTracks, identityKey, saveProgress } = opts;
  const hasSource = !!videoUrl;
  // Always direct-plays and falls back to a transcode only if the browser
  // can't decode the source -- no manual quality picker. That picker (4K/
  // 1080p) meant forcing a transcode on demand, and the transcode path has
  // repeatedly been the less reliable one in real testing; auto-only means
  // a viewer never lands there except when direct play genuinely can't
  // work, which is exactly when the transcode is actually needed. Seeded
  // from forceTranscode, not always false -- some titles need to skip
  // direct play altogether (see the option's own doc).
  const [autoFellBack, setAutoFellBack] = useState(forceTranscode);
  const transcoding = autoFellBack;
  // One id for this whole viewing, sent as Jellyfin's PlaySessionId on every
  // transcode request so a seek is recognised as "move this session", not a
  // brand new independent stream. Generated once, lazily, on first render.
  const [playSessionId] = useState(() => crypto.randomUUID());
  // A transcode is *always* delivered as HLS, not a plain progressive MP4 --
  // that turned out to be unreliable in real testing (confirmed hanging
  // indefinitely in the browser, readyState never leaving HAVE_NOTHING,
  // despite Jellyfin correctly streaming real bytes the whole time). HLS is
  // what Jellyfin's own official web client uses for every transcode for
  // exactly this reason. Safari can play the manifest natively via a plain
  // <video src>; everyone else needs hls.js to feed it in via MSE -- see the
  // hls.js-management effect below and supportsNativeHls for why
  // canPlayType() isn't how that split gets decided.
  const [nativeHlsSupport] = useState(supportsNativeHls);
  const needsHlsJs = transcoding && !nativeHlsSupport;
  const hlsRef = useRef<Hls | null>(null);
  const [selectedSubtitle, setSelectedSubtitle] = useState<number | null>(null);
  // No start-position parameter, deliberately. Jellyfin's HLS output is a
  // complete VOD playlist of the *whole* title (verified directly against the
  // server: 891 segments / 2671s, byte-identical with and without
  // startTimeTicks), and its segments are addressed purely by index. So
  // startTimeTicks never moved the stream -- the player still began at
  // segment 0, i.e. the title's start, while the chrome displayed the
  // requested position on top of it. That mismatch is what "seeking restarts
  // the episode" and "resume plays from the beginning" both were.
  //
  // Because the playlist covers the entire title up front, seeking needs no
  // new stream at all: setting currentTime makes hls.js fetch the segment at
  // that position and Jellyfin transcodes it on demand (measured: 0.65s for a
  // cold seek 10 minutes in, 0.13s for the next segment). That is both correct
  // and far faster than tearing the transcode down and rebuilding it, which is
  // what this used to do on every scrub.
  const videoSrc = !videoUrl ? "" : transcoding ? `${videoUrl}/hls/master.m3u8?session=${playSessionId}` : videoUrl;
  // Best-effort: tell Jellyfin to kill the ffmpeg job for the current session
  // before asking for a new position. Without this, Jellyfin can leave the
  // old encode running and just keep serving *that*, ignoring the new
  // startTimeTicks entirely -- which is what made seeking during a transcode
  // snap back to wherever the transcode first started.
  //
  // Returns the request's promise -- callers must await it before triggering
  // the new stream request. Firing them in parallel re-introduces the exact
  // race this exists to close: if the new stream request reaches Jellyfin
  // before the stop does, Jellyfin sees an already-active session and keeps
  // serving the old encode regardless. That race doesn't fire every time --
  // explains why the old fire-and-forget version "sometimes" still snapped
  // back rather than always.
  const stopCurrentTranscode = () => {
    return fetch("/api/stream/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playSessionId }),
    }).catch(() => {});
  };
  // Absolute (real-timeline) position to resume at after a source swap --
  // Auto's codec fallback, or a transcode-seek restart.
  const resumeAtRef = useRef<number | null>(null);
  // Guards the reload effect from firing on first mount, where the initial
  // source and the saved-progress seek are handled elsewhere.
  const didSwapRef = useRef(false);
  const [playing, setPlaying] = useState(autoPlay && hasSource);
  const [showOverlay, setShowOverlay] = useState(!autoPlay || !hasSource);
  const [isMobile, setIsMobile] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  // Separate from videoLoading, which is specifically "nothing is playing
  // yet" (pre-play, a fallback swap). This is "playback is up but has run
  // out of buffer mid-stream" -- a real, different state that had no
  // indicator at all before; the picture just froze with no feedback.
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Real, DOM-event-driven play/pause intent -- distinct from `playing`
  // above, which only ever means "has playback started successfully" and is
  // never reset by a manual pause. Several play() calls in this file are
  // deferred behind a real event (loadedmetadata in seekThenRun, canplay for
  // hls.js/a source swap) that can resolve *after* the viewer already
  // clicked pause; without this, that late event calls v.play() anyway and
  // silently undoes the pause. Reported live as "clicking the pause button
  // doesn't actually pause the video." usePlayerChrome's togglePlay() calls
  // v.pause()/v.play() directly on the element with no way to cancel a
  // callback already scheduled here, so the guard has to be a real
  // 'pause'/'play' listener on the element itself, set fresh at the start of
  // every play attempt (see doPlay()/onReady below) and checked again right
  // before each deferred play() actually runs.
  const playIntentRef = useRef<"play" | "pause">("pause");
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPause = () => { playIntentRef.current = "pause"; };
    const onPlayEvt = () => { playIntentRef.current = "play"; };
    v.addEventListener("pause", onPause);
    v.addEventListener("play", onPlayEvt);
    return () => {
      v.removeEventListener("pause", onPause);
      v.removeEventListener("play", onPlayEvt);
    };
  }, []);
  // Seeking is the same operation for both delivery paths now: set
  // currentTime. Direct play seeks via Range requests; a transcode seeks
  // within its full-timeline HLS playlist (see videoSrc). Neither needs the
  // stream rebuilt, so there's no offset to add and nothing to intercept.
  const chrome = usePlayerChrome(videoRef, containerRef, {
    knownDurationSeconds: runtimeMinutes ? runtimeMinutes * 60 : null,
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

  // Buffering indicator, independent of which delivery mechanism is active
  // (direct play, hls.js, or native HLS all fire these same native
  // HTMLMediaElement events) -- one listener covers every case rather than
  // needing its own signal per source type.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    return () => {
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
    };
  }, []);

  // Feeds an HLS transcode into the video element via MSE for every browser
  // without native HLS support (see nativeHlsSupport/needsHlsJs above) --
  // native support and direct play both just use the <video src> attribute
  // normally (set by the caller's JSX), so this only exists for the hls.js
  // case. Runs on mount too, not just later swaps: videoSrc can already be
  // in the hls.js state on the very first render (a resumed title where
  // direct play had already fallen back before, or forceTranscode). Placed
  // before the reload effect below so its teardown/recreate happens first on
  // a shared dependency change -- that effect's canplay listener needs the
  // *new* instance already attached, not the old one mid-teardown.
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
      // Nothing lower to fall back to here -- this is already the
      // transcode, and Jellyfin already picked a broadly-compatible target.
      // Mirrors the video onError real-error branch the caller wires up.
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

  // The one remaining source swap: Auto's codec fallback flipping
  // `transcoding`, which changes the src. (Seeking no longer swaps the source
  // -- see videoSrc.) Force the element to load the new URL and resume --
  // changing src alone can leave a browser sitting on the media it just gave
  // up on. Wait for `canplay`, not just metadata.
  //
  // Skips v.load() when hls.js owns the element (needsHlsJs) -- the effect
  // above already tears down and recreates the hls.js instance on the same
  // videoSrc change, and calling the native load() directly on an element
  // hls.js is attached to fights its own lifecycle management.
  useEffect(() => {
    if (!didSwapRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    // Fresh intent: this reload represents continuing playback across a
    // forced source swap (Auto's codec fallback, or a late forceTranscode),
    // not a new user click -- but it still must not fight a pause that
    // lands while the swap is in flight and canplay hasn't fired yet.
    playIntentRef.current = "play";
    if (!needsHlsJs) v.load();
    const onReady = () => {
      const target = resumeAtRef.current;
      resumeAtRef.current = null;
      // Applies to a transcode too, not just direct play: the HLS playlist
      // covers the whole title, so restoring the position after a source swap
      // is the same client-side seek in both cases (see videoSrc). Clamped to
      // what's actually seekable so an out-of-range set can't stall a
      // partially-buffered source.
      if (target != null) {
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
      // Skip resuming if a real pause landed while the swap was in flight --
      // the seek/subtitle restoration above still applies regardless, so the
      // paused frame lands in the right place rather than the swap's start.
      if (playIntentRef.current === "play") v.play().catch(() => {});
      setVideoLoading(false);
    };
    v.addEventListener("canplay", onReady, { once: true });
    return () => v.removeEventListener("canplay", onReady);
  }, [transcoding, subtitleTracks, selectedSubtitle, needsHlsJs]);

  // Viewer picked a subtitle track (or turned them off).
  useEffect(() => {
    const v = videoRef.current;
    if (v) applySubtitleMode(v, subtitleTracks, selectedSubtitle);
  }, [selectedSubtitle, subtitleTracks]);

  // Mobile plays from the tap handler instead, which is the only place
  // fullscreen can actually be requested. Checks isMobileViewport()
  // directly, not just the isMobile state -- both this effect and the
  // mobile-detection one above run in the same initial commit, and this one
  // is declared later, so on first mount it can still see this render's
  // stale isMobile=false before the other effect's correction has taken
  // effect. That let a mobile viewer's video briefly autoplay inline before
  // the correction landed, which is what "the overlay doesn't show up until
  // refreshing" turned out to be.
  useEffect(() => {
    if (!hasSource || !playing || !videoRef.current || isMobile || isMobileViewport()) return;
    const v = videoRef.current;
    setVideoLoading(true);
    const startPlayback = () => {
      // The wait above (loadedmetadata or canplay) can resolve after the
      // viewer already clicked pause -- don't fight a pause that landed
      // while this was still loading.
      if (playIntentRef.current !== "play") {
        setVideoLoading(false);
        return;
      }
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
    const doPlay = () => {
      // Fresh intent: about to attempt a real play, whether it resolves
      // immediately or after a deferred wait below.
      playIntentRef.current = "play";
      // Both paths resume the same way. A transcode used to be skipped here on
      // the assumption its URL already started at the right place -- it never
      // did (see videoSrc), which is why resuming a transcoded title replayed
      // it from the beginning.
      if (initialProgressSeconds > 0) seekThenRun(v, initialProgressSeconds, startPlayback);
      else startPlayback();
    };
    if (needsHlsJs) {
      // hls.js needs a moment to fetch and parse the manifest before play()
      // can succeed -- firing immediately, the way direct play and native
      // HLS do, would just reject every time.
      v.addEventListener("canplay", doPlay, { once: true });
      return () => v.removeEventListener("canplay", doPlay);
    }
    doPlay();
  }, [hasSource, playing, initialProgressSeconds, isMobile, needsHlsJs, transcoding]);

  const handlePlayClick = () => {
    const v = videoRef.current;
    if (!v) {
      setPlaying(true);
      setShowOverlay(false);
      return;
    }
    setVideoLoading(true);
    setPlaybackError(false);
    const startPlayback = () => {
      // Same guard as the mount effect's startPlayback -- a click here can
      // still be waiting on hls.js's manifest when a *later* pause click
      // lands; don't let this one override that.
      if (playIntentRef.current !== "play") {
        setVideoLoading(false);
        return;
      }
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
    const doPlay = () => {
      // Fresh intent -- see the mount effect's doPlay.
      playIntentRef.current = "play";
      // Same for both paths -- see the mount effect's doPlay.
      if (initialProgressSeconds > 0) seekThenRun(v, initialProgressSeconds, startPlayback);
      else startPlayback();
    };
    // Fullscreen is opt-in via the chrome's own button (usePlayerChrome), not
    // forced here. Jumping straight to native video fullscreen used to
    // happen right at this tap -- before anything had even loaded -- and it
    // replaces the whole element with the OS's own player UI, which is why
    // the custom chrome never showed on mobile at all. The chrome's
    // fullscreen button tries container fullscreen first, which keeps the
    // chrome as a sibling and visible; it only falls back to native video
    // fullscreen if that's unsupported.
    if (needsHlsJs) {
      // Same reasoning as the mount effect above -- wait for hls.js to
      // actually have something playable rather than firing immediately.
      if (v.readyState >= 3) doPlay();
      else v.addEventListener("canplay", doPlay, { once: true });
    } else {
      // A previous attempt can leave the element in a failed state that
      // won't retry on play() alone -- reload it so a retry is a real retry
      // rather than an unresponsive-looking no-op.
      if (v.error) v.load();
      doPlay();
    }
  };

  // Progress tracking -- periodic while playing, and once more on pause.
  useEffect(() => {
    if (!playing) return;
    const v = videoRef.current;
    if (!v) return;
    let lastSaved = 0;
    const onTimeUpdate = () => {
      const sec = Math.floor(v.currentTime);
      if (sec > 0 && sec - lastSaved >= PROGRESS_SAVE_INTERVAL_SEC) {
        lastSaved = sec;
        saveProgress(sec);
      }
    };
    const onPause = () => {
      const sec = Math.floor(v.currentTime);
      if (sec > 0) saveProgress(sec);
    };
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("pause", onPause);
    };
  }, [playing, identityKey, saveProgress]);

  // The unmount cleanup below only re-creates when identityKey changes, so a
  // closed-over `transcoding` would go stale the moment it changes after
  // mount -- mirror it into a ref (via its own effect, not during render)
  // and read that instead.
  const transcodingRef = useRef(transcoding);
  useEffect(() => {
    transcodingRef.current = transcoding;
  }, [transcoding]);

  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v && v.currentTime > 0) saveProgress(Math.floor(v.currentTime));
      // Leaving the page mid-transcode would otherwise leave that ffmpeg job
      // running on the mediabox indefinitely -- nothing else ever tells
      // Jellyfin this session is done.
      if (transcodingRef.current) stopCurrentTranscode();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  // Auto's own fallback: a direct-play failure (almost always an
  // unsupported codec) drops to the transcode and keeps playing rather than
  // showing the error overlay. Only a failure while already transcoding is a
  // real error -- there's nothing lower to fall back to. Callers wire this
  // straight onto the <video>'s onError.
  const onVideoError = () => {
    if (hasSource && !transcoding) {
      // resumeAtRef alone carries the position across the swap now -- the
      // reload effect seeks the new source there once it's ready.
      resumeAtRef.current = chrome.currentTime > 0 ? chrome.currentTime : null;
      didSwapRef.current = true;
      setAutoFellBack(true);
      setVideoLoading(true);
      return;
    }
    setPlaying(false);
    setShowOverlay(true);
    setVideoLoading(false);
    setPlaybackError(true);
  };

  const onVideoPlay = () => {
    setShowOverlay(false);
    setPlaybackError(false);
    chrome.revealControls();
  };

  // forceTranscode can arrive *after* mount: the show-page overlay renders
  // the player immediately (so an episode tap feels instant) and only learns
  // forceTranscode from an async fetch a moment later -- unlike the two
  // standalone watch pages, which resolve it server-side before the player
  // ever mounts. autoFellBack above only seeds from the prop's value at
  // mount, so a forceTranscode that flips true afterward would otherwise be
  // silently missed and the player would sit on a direct-play attempt
  // already known to fail (this is why the HLS/HEVC fixes alone didn't
  // change anything for titles opened this way -- the transcode path they
  // fixed was never actually being requested). Mirror onVideoError's
  // swap-to-transcode path so a late-arriving forceTranscode behaves exactly
  // like a direct-play failure caught in flight. Guarded by identityKey (not
  // a plain boolean) so switching titles without unmounting -- this
  // component isn't remounted per episode -- re-arms it for the next one.
  const forceTranscodeAppliedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!forceTranscode || transcoding) return;
    if (forceTranscodeAppliedForRef.current === identityKey) return;
    forceTranscodeAppliedForRef.current = identityKey;
    // Keep whatever position playback had reached, falling back to the saved
    // one when it hasn't started yet -- the reload effect seeks there.
    resumeAtRef.current = chrome.currentTime > 0 ? chrome.currentTime : initialProgressSeconds || null;
    didSwapRef.current = true;
    setAutoFellBack(true);
    setVideoLoading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceTranscode, identityKey, transcoding]);

  return {
    hasSource,
    transcoding,
    needsHlsJs,
    videoSrc,
    selectedSubtitle,
    setSelectedSubtitle,
    playing,
    setPlaying,
    showOverlay,
    setShowOverlay,
    videoLoading,
    buffering,
    playbackError,
    videoRef: videoRef as RefObject<HTMLVideoElement>,
    containerRef: containerRef as RefObject<HTMLDivElement>,
    chrome,
    handlePlayClick,
    onVideoError,
    onVideoPlay,
  };
}
