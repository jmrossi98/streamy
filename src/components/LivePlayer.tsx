"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { supportsNativeHls } from "@/lib/hlsSupport";
import { usePlayerChrome } from "@/lib/usePlayerChrome";
import { VideoChrome } from "@/components/VideoChrome";

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
 * waits forever.
 *
 * 60s, not the 25s this used to be. Tuning goes through Jellyfin, which opens
 * the upstream, probes it, and only serves a playlist once it has three HLS
 * segments at hls_time 3 -- nine seconds of content before the first byte can
 * reach a viewer. Measured end to end on the live channels after capping the
 * probe (mediabox-infra#77): 18-26s.
 *
 * At 25s that was a coin flip. A channel that tuned in 26 seconds was reported
 * as off air, which is the most misleading thing this component can say: it
 * sends someone to debug a stream that was about to play.
 *
 * The number is deliberately well clear of the measured range rather than just
 * above it, because the upstreams are third-party IPTV and their open time is
 * not ours to control. The cost of waiting too long is a spinner; the cost of
 * giving up too early is a wrong answer.
 */
const TUNE_TIMEOUT_MS = 60_000;

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Playback started and then stalled, as opposed to never having started. */
  const [rebuffering, setRebuffering] = useState(false);
  /** Autoplay was refused. Not a failure -- it needs a click, and says so. */
  const [needsGesture, setNeedsGesture] = useState(false);
  /** Seconds behind the live edge. Null until the stream reports a seekable range. */
  const [behind, setBehind] = useState<number | null>(null);
  /**
   * The seekable window, as the stream currently reports it.
   *
   * Both ends move: HLS drops segments off the back as it adds them to the
   * front, so this is re-read on every timeupdate rather than measured once.
   * How much is in it is Jellyfin's decision, not this player's -- the bar
   * shows whatever is actually there, which may be a couple of minutes or a
   * couple of seconds.
   */
  const [dvr, setDvr] = useState<{ start: number; edge: number } | null>(null);

  // No knownDurationSeconds: a broadcast has no runtime to pin the bar to.
  const chrome = usePlayerChrome(videoRef, containerRef);

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

    /*
      The id this tune is opened under, minted here so this component can name
      it again to shut it down. It used to be generated server-side and thrown
      away, leaving nothing on the client that could close anything -- so every
      channel anyone left kept ffmpeg encoding until Jellyfin timed it out.
      Measured 2026-09-18: two jobs encoding for over 1h40m with Jellyfin
      reporting zero sessions playing.

      That costs more than CPU. h264_nvenc caps concurrent sessions, so
      abandoned tunes eat encoder slots until channels stop starting or drop to
      software encoding -- which reaches the viewer as a slow tune that then
      stutters.
    */
    const playSessionId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const src = `/api/stream/live/${encodeURIComponent(channelId)}/hls/master.m3u8?playSessionId=${encodeURIComponent(playSessionId)}`;
    let hls: Hls | null = null;

    /*
      Two paths on purpose. fetch(keepalive) covers leaving the page within the
      app, where the request outlives the component; sendBeacon covers the tab
      actually closing, which is the case no unmount handler ever runs for.
      Both are fire-and-forget: the viewer is already gone.
    */
    const endTune = (useBeacon: boolean) => {
      const body = JSON.stringify({ playSessionId });
      try {
        if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon("/api/stream/live/stop", new Blob([body], { type: "text/plain" }));
          return;
        }
        void fetch("/api/stream/live/stop", {
          method: "POST",
          body,
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      } catch {
        // Teardown must never throw into a page that is going away.
      }
    };

    const onPageHide = () => endTune(true);
    window.addEventListener("pagehide", onPageHide);

    // Nothing here fires if the channel is dead, which is the whole problem:
    // the timer is the only thing that can tell the difference between "still
    // tuning" and "never going to start".
    let tuneTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      tuneTimer = null;
      setLoading((stillLoading) => {
        if (stillLoading) {
          setError(
            "This channel didn’t start. The stream is most likely off air — " +
              "the channel list includes it either way."
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
      if (video.seekable.length === 0) {
        setBehind(null);
        setDvr(null);
        return;
      }
      const last = video.seekable.length - 1;
      const edge = video.seekable.end(last);
      const start = video.seekable.start(0);
      setBehind(Math.max(0, edge - video.currentTime));
      setDvr({ start, edge });
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
      window.removeEventListener("pagehide", onPageHide);
      // hls.destroy() ends the *client* fetching and nothing more -- the
      // comment that used to sit here claimed it tore down the transcode
      // upstream, and that is exactly the assumption that left ffmpeg running.
      // Jellyfin has to be told.
      endTune(false);
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
      <div ref={containerRef} className="relative w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          /*
            No `controls`. The comment that used to sit here said "no seek bar"
            while the attribute was right underneath it, so the browser drew
            its native scrubber -- with a total duration, over a timeline that
            grows as the broadcast runs. That end time is what made a live
            channel read as a recording.

            VideoChrome replaces it, and in live mode the same bar means
            something true: the span is the seekable window, and the right-hand
            end is now rather than a finish.
          */
          playsInline
          onClick={chrome.togglePlay}
          onMouseMove={chrome.revealControls}
          className="aspect-video w-full bg-black"
        />

        {/* Only once something is playing: chrome over a tuning spinner is
            controls for a stream that does not exist yet. */}
        {!loading && !error && (
          <VideoChrome
            title={channelName}
            subtitle={nowPlaying ?? undefined}
            chrome={chrome}
            live={{
              windowStart: dvr?.start ?? 0,
              edge: dvr?.edge ?? 0,
              atLive: !isBehind,
              goLive,
            }}
          />
        )}

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

      {/*
        The live badge used to live here, below the frame, because there was no
        chrome to put it in. It is inside the player now -- where the scrubber
        it describes is, and where every other platform puts it -- so this row
        is just the channel's identity, which stays visible when the controls
        fade.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{channelName}</p>
          {nowPlaying && <p className="truncate text-xs text-white/50">{nowPlaying}</p>}
        </div>
      </div>
    </div>
  );
}
