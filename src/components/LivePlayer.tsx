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

    const onPlaying = () => setLoading(false);
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

    if (supportsNativeHls()) {
      video.src = src;
      video.play().catch(() => setLoading(false));
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
        video.play().catch(() => setLoading(false));
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        setError(
          data.response?.code === 503
            ? "This channel couldn’t be tuned. The stream may be offline."
            : "Playback failed."
        );
        setLoading(false);
      });
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("This browser can’t play live streams.");
      setLoading(false);
    }

    return () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTimeUpdate);
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
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/50">
            Tuning…
          </p>
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
