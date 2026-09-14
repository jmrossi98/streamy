"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { supportsNativeHls } from "@/lib/hlsSupport";

type Props = {
  channelId: string;
  channelName: string;
  /** Shown under the title -- what's on now, when the guide knows. */
  nowPlaying?: string | null;
};

/**
 * How long to wait for a channel to actually start before saying so.
 *
 * A playlist entry is not a promise that anything is broadcasting. A dead
 * channel usually does not fail -- the manifest loads, the transcode starts,
 * and no video data ever arrives -- so nothing fires an error and the player
 * waits forever. Matches LIVE_TV_TIMEOUT_MS, which is how long the tune
 * request itself is given.
 */
const TUNE_TIMEOUT_MS = 25_000;

/** Indeterminate progress, for a wait with no knowable length. */
function Spinner({ label }: { label: string }) {
  return (
    <span className="flex flex-col items-center gap-2" role="status" aria-live="polite">
      <svg className="h-8 w-8 animate-spin text-white/70" viewBox="0 0 24 24" aria-hidden>
        {/* Track plus arc: the arc alone reads as a fragment rather than as a
            ring that is going round. */}
        <circle
          className="opacity-20"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="text-sm text-white/60">{label}</span>
    </span>
  );
}

/**
 * Plays a live channel.
 *
 * Deliberately not usePlayerEngine. That hook is built around a duration, a
 * resume position, progress to save and a seekable timeline -- a broadcast has
 * none of them, and routing live through it would mean disabling most of it
 * and working around the rest.
 *
 * Always HLS: Jellyfin delivers a tuned channel as a transcode, and a
 * transcode is always HLS. There is no direct-play path to fall back to.
 */
export function LivePlayer({ channelId, channelName, nowPlaying }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Playback started and then stalled, as opposed to never having started. */
  const [rebuffering, setRebuffering] = useState(false);
  /** Autoplay was refused. Not a failure -- it needs a click, and says so. */
  const [needsGesture, setNeedsGesture] = useState(false);
  /** Seconds behind the live edge. Null until the stream reports a seekable range. */
  const [behind, setBehind] = useState<number | null>(null);

  /**
   * Jumps to the live edge.
   *
   * A live HLS stream has a seekable window -- a few minutes of segments the
   * player could scrub back through -- so falling behind is possible (a pause,
   * a stall, a backgrounded tab). Live players offer a way back rather than
   * leaving you permanently minutes late with no indication why.
   */
  const goLive = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.seekable.length === 0) return;
    v.currentTime = v.seekable.end(v.seekable.length - 1);
    void v.play().catch(() => {});
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const src = `/api/stream/live/${encodeURIComponent(channelId)}/hls/master.m3u8`;
    let hls: Hls | null = null;

    // Nothing here fires if the channel is dead, which is the whole problem:
    // the timer is the only thing that can tell the difference between "still
    // tuning" and "never going to start".
    let tuneTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      tuneTimer = null;
      setLoading((stillLoading) => {
        if (stillLoading) {
          setError(
            "This channel isn’t sending any video. It’s most likely off air — " +
              "the playlist lists it either way."
          );
        }
        return false;
      });
    }, TUNE_TIMEOUT_MS);

    const clearTuneTimer = () => {
      if (tuneTimer !== null) {
        clearTimeout(tuneTimer);
        tuneTimer = null;
      }
    };

    const onPlaying = () => {
      clearTuneTimer();
      setLoading(false);
      setRebuffering(false);
      setNeedsGesture(false);
    };
    // Mid-stream stalls get the spinner back rather than a frozen frame, and
    // are kept distinct from the initial tune so the timeout above doesn't
    // treat a brief rebuffer as a dead channel.
    const onWaiting = () => setRebuffering(true);

    /**
     * A rejected play() used to just clear the spinner, leaving a black
     * rectangle with no text -- the reported symptom. Two very different
     * causes, so they are told apart: the browser refusing to autoplay wants a
     * click, and anything else is a real failure.
     */
    const startPlayback = () => {
      video.play().catch((err: unknown) => {
        clearTuneTimer();
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "AbortError") {
          setNeedsGesture(true);
        } else {
          setError("Playback couldn’t start.");
        }
        setLoading(false);
      });
    };
    // How far behind the live edge we are, recomputed as playback moves. This
    // is what replaces a progress bar: a broadcast has no start and no end, so
    // "37% through" is meaningless, but "2 minutes behind live" is not.
    const onTimeUpdate = () => {
      if (video.seekable.length === 0) return setBehind(null);
      const edge = video.seekable.end(video.seekable.length - 1);
      setBehind(Math.max(0, edge - video.currentTime));
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);

    if (supportsNativeHls()) {
      video.src = src;
      startPlayback();
    } else if (Hls.isSupported()) {
      hls = new Hls({
        // A broadcast has no history worth seeking into, and a long buffer just
        // means starting further behind live.
        liveSyncDurationCount: 3,
        enableWorker: true,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        startPlayback();
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        clearTuneTimer();
        setError(
          data.response?.code === 503
            ? "This channel couldn’t be tuned. The stream may be offline."
            : "Playback failed."
        );
        setLoading(false);
      });
    } else {
      clearTuneTimer();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("This browser can’t play live streams.");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
    }

    return () => {
      clearTuneTimer();
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      // Tears down the transcode upstream too -- without this Jellyfin keeps a
      // tuner allocated and ffmpeg running for a channel nobody is watching.
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [channelId]);

  // A couple of seconds behind is just buffering, not "behind live" -- every
  // live stream sits slightly back from the edge by design.
  const isBehind = behind !== null && behind > 20;

  return (
    <div className="w-full">
      <div className="relative w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          // No seek bar: `controls` would draw a scrubber over a timeline that
          // grows as the broadcast runs, which is what made this look like a
          // recording. Volume and fullscreen are kept; scrubbing is not a thing
          // you do to live television.
          controls
          controlsList="nodownload noplaybackrate"
          playsInline
          className="aspect-video w-full bg-black"
        />

        {loading && !error && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner label="Tuning…" />
          </span>
        )}
        {/* Rebuffering is drawn over the frozen frame rather than replacing it,
            and only once playback has started -- otherwise a stall during the
            initial tune would stack two spinners. */}
        {rebuffering && !loading && !error && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
            <Spinner label="Reconnecting…" />
          </span>
        )}
        {needsGesture && !error && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 px-6 text-center text-sm text-white/70">
            Press play to start this channel.
          </span>
        )}
        {error && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {/* The live indicator, in place of a clock counting up. Red and solid
            when at the edge; muted with a way back when behind. */}
        {isBehind ? (
          <button
            type="button"
            onClick={goLive}
            className="flex items-center gap-1.5 rounded bg-white/10 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white/70 transition-colors hover:bg-white/20"
            title="Jump to live"
          >
            <span className="h-2 w-2 rounded-full bg-white/40" />
            Go live
          </button>
        ) : (
          <span className="flex items-center gap-1.5 rounded bg-netflix-red px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
            <span className="h-2 w-2 rounded-full bg-white" />
            Live
          </span>
        )}

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{channelName}</p>
          {nowPlaying && <p className="truncate text-xs text-white/50">{nowPlaying}</p>}
        </div>
      </div>
    </div>
  );
}
