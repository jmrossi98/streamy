"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { supportsNativeHls } from "@/lib/hlsSupport";

type Props = {
  channelId: string;
  channelName: string;
  onClose: () => void;
};

/**
 * Player for a live channel.
 *
 * Deliberately not usePlayerEngine. That hook is built around things a
 * broadcast doesn't have -- a duration, a resume position, progress to save,
 * a seekable timeline, a transcode-on-demand fallback keyed to a start time.
 * Wiring live TV through it would mean disabling most of it and then working
 * around the rest. This is the whole of what live needs: point hls.js at the
 * proxied master playlist and play.
 *
 * Always HLS. Jellyfin delivers a tuned channel as a transcode, and a
 * transcode is always HLS -- there is no direct-play path to fall back to.
 */
export function LivePlayer({ channelId, channelName, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const src = `/api/stream/live/${encodeURIComponent(channelId)}/hls/master.m3u8`;
    let hls: Hls | null = null;

    const onPlaying = () => setLoading(false);
    video.addEventListener("playing", onPlaying);

    if (supportsNativeHls()) {
      video.src = src;
      video.play().catch(() => {
        // Autoplay refusal is not a failure -- the controls are right there.
        setLoading(false);
      });
    } else if (Hls.isSupported()) {
      hls = new Hls({
        // A broadcast has no history to seek back into, and a long buffer just
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
        // A 503 here is the channel failing to tune, which is the common case
        // with a public playlist full of dead entries -- say that plainly
        // rather than showing a generic player error.
        setError(
          data.response?.code === 503
            ? "This channel couldn’t be tuned. The stream may be offline."
            : "Playback failed."
        );
        setLoading(false);
      });
    } else {
      // Capability detection has to happen here, not during render: both checks
      // touch browser APIs that don't exist during SSR, and a lazy initializer
      // would evaluate them on the server and hydrate to a different answer.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("This browser can’t play live streams.");
      setLoading(false);
    }

    return () => {
      video.removeEventListener("playing", onPlaying);
      // Tears down the transcode upstream too -- without this Jellyfin keeps a
      // tuner allocated and ffmpeg running for a channel nobody is watching.
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [channelId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{channelName}</p>
          <p className="text-xs text-white/40">Live</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
        >
          Close
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video
          ref={videoRef}
          controls
          playsInline
          className="max-h-full max-w-full"
        />
        {loading && !error && (
          <p className="pointer-events-none absolute text-sm text-white/50">Tuning…</p>
        )}
        {error && (
          <div className="absolute px-6 text-center">
            <p className="text-sm text-red-400">{error}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
            >
              Back to channels
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
