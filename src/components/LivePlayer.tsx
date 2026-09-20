"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { supportsNativeHls } from "@/lib/hlsSupport";
import { liveSeekTarget } from "@/lib/liveTimeline";
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

/**
 * How far behind the live edge to sit, in seconds.
 *
 * Not zero, and not a segment count. Sitting exactly at the edge means every
 * upstream hiccup is a stall, because there is nothing buffered to play
 * through it -- and these upstreams are third-party IPTV whose time to first
 * byte was measured between 4 and 19 seconds, so hiccups are the normal case.
 *
 * Seconds rather than hls.js's *DurationCount settings because those multiply
 * by segment length, and segment length changed from 3s to 1s when the tune
 * latency was fixed (mediabox-infra#78). The old `liveSyncDurationCount: 3`
 * quietly went from nine seconds of protection to three.
 */
const LIVE_SYNC_SECONDS = 8;

/**
 * How much back-buffer hls.js keeps client-side.
 *
 * Used to be 1800s (30 minutes) to support scrubbing back through a DVR
 * window -- that control is gone (see VideoChrome: no scrubber in live mode
 * anymore), so there is nothing left that seeks backward. What is left that
 * still touches this is the edge-stall recovery below, which only ever seeks
 * *forward* to the live edge -- it needs no history at all, just enough
 * slack that a momentary stall doesn't immediately evict the segment
 * playback is sitting on. A minute is generous for that.
 */
const BACK_BUFFER_SECONDS = 60;

/**
 * A stall this long at the live edge is treated as having fallen off the end,
 * not as ordinary rebuffering.
 *
 * The EVENT playlist grows rather than slides, so a player that catches up to
 * the encoder waits at a position that will never have more data *in the
 * past*. Waiting it out is what produced the reported "buffers, then tries to
 * reconnect" -- the fix is to move, not to wait.
 */
const EDGE_STALL_RECOVERY_MS = 6_000;

/**
 * How many times a dead tune retries itself before actually reporting the
 * error, and how long each retry waits before trying.
 *
 * A fatal hls.js error or a tune timeout used to be terminal: the viewer saw
 * "Playback failed" and had to manually go back and re-select the channel.
 * Reported live: a channel died on Jellyfin's own client too at the same
 * moment -- the shared upstream or transcode had the problem, not this
 * player -- and Jellyfin's client doesn't self-heal from that either. This
 * player can, by re-tuning itself the same way a manual re-select would.
 *
 * Linear rather than exponential backoff, and capped at three: a genuinely
 * dead channel (provider offline, not a transient hiccup) must still end in
 * the real error rather than retry forever, and each attempt already costs
 * up to TUNE_TIMEOUT_MS if the failure is a hang rather than a fast error.
 */
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3_000;

/**
 * Moves playback to the live edge, minus the sync cushion.
 *
 * `seekable.end()` is the furthest the player can go; landing exactly there is
 * what causes an immediate stall, so it deliberately lands LIVE_SYNC_SECONDS
 * short of it. Returns false when there is no seekable range yet, which is the
 * normal state for the first moments of a tune.
 */
function seekToLiveEdge(
  video: HTMLVideoElement,
  opts: { forwardOnly?: boolean } = {}
): boolean {
  if (video.seekable.length === 0) return false;
  const edge = video.seekable.end(video.seekable.length - 1);
  const start = video.seekable.start(0);

  // The decision lives in liveTimeline.ts so it can be tested without a
  // browser -- it is the logic whose unconditional version rewound the
  // playhead on every stall and replayed the same seconds indefinitely.
  const target = liveSeekTarget(video.currentTime, start, edge, LIVE_SYNC_SECONDS, opts);
  if (target === null) return false;

  video.currentTime = target;
  return true;
}

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
  /**
   * Seconds behind the live edge. Null until the stream reports a seekable
   * range. Re-read on every timeupdate -- HLS drops segments off the back as
   * it adds them to the front, so the edge moves. Drives `isBehind` below,
   * which is now only for the LIVE badge's colour: catching back up is
   * automatic (see `onPlay`, `onWaiting`), not something a viewer triggers.
   */
  const [behind, setBehind] = useState<number | null>(null);
  /**
   * Bumped to force a fresh tune of the same channel after a failure.
   *
   * Included in the tune effect's own dependency array below, so incrementing
   * it re-runs the whole effect exactly as a channelId change would: full
   * teardown (closes the dead Jellyfin stream, destroys the old hls.js
   * instance), then a genuinely fresh attempt with a new playSessionId --
   * the same thing a manual back-and-reselect would produce, just automatic.
   */
  const [retryToken, setRetryToken] = useState(0);
  /** How many consecutive failed attempts *this* channel has had. */
  const retryCountRef = useRef(0);
  /** Which channel retryCountRef's count belongs to, so switching channels starts fresh. */
  const retryChannelIdRef = useRef<string | null>(null);

  /*
    Whether the viewer deliberately scrubbed back into the DVR window.

    Set from the video's own `seeked` event rather than plumbed down from the
    scrubber, so it is true however the position changed -- the bar, a keyboard
    arrow, or the OS media controls.

    Recovery and catch-up both consult it. Without it, seeking back to watch a
    replay meant the next stall silently dragged you to live again, which reads
    as the player refusing to stay where it was put.
  */
  const stayBehindRef = useRef(false);

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
    if (!v) return;
    // Via seekToLiveEdge rather than seeking to seekable.end() directly.
    // Landing exactly on the edge leaves nothing buffered ahead, so "go live"
    // reliably produced an immediate stall -- the button appeared to break
    // playback rather than restore it.
    stayBehindRef.current = false;
    if (!seekToLiveEdge(v)) return;
    void v.play().catch(() => {});
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // A genuine channel change gets a fresh retry budget; a retry of the
    // same channel (channelId unchanged, only retryToken bumped) keeps
    // whatever count it already had, which is the thing MAX_RETRIES bounds.
    if (retryChannelIdRef.current !== channelId) {
      retryChannelIdRef.current = channelId;
      retryCountRef.current = 0;
    }

    /*
      Throttle for the continuous drift correction in onTimeUpdate below.
      Plain closure state, not a ref: written and read synchronously in the
      same handler, never across a render.
    */
    let lastCatchUpAt = 0;
    const CATCH_UP_COOLDOWN_MS = 4_000;

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

    /**
     * Retries the tune, or -- past MAX_RETRIES -- gives up and shows the
     * real error.
     *
     * Bumping retryToken re-runs this whole effect (see its dependency array
     * below), tearing down and starting over exactly as a channel change
     * would: a fresh playSessionId, a new hls.js instance, a fresh Jellyfin
     * live stream open. `loading` is deliberately left alone on the retry
     * path -- it is already true at every call site this is used from, so
     * the viewer keeps seeing the same "Tuning..." spinner a first attempt
     * shows, not a flash of an error that then heals itself.
     */
    const scheduleRetry = (finalError: string) => {
      if (retryCountRef.current >= MAX_RETRIES) {
        setError(finalError);
        setLoading(false);
        return;
      }
      retryCountRef.current += 1;
      setTimeout(() => {
        setRetryToken((t) => t + 1);
      }, RETRY_BACKOFF_MS * retryCountRef.current);
    };

    // Nothing here fires if the channel is dead, which is the whole problem:
    // the timer is the only thing that can tell the difference between "still
    // tuning" and "never going to start".
    let tuneTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      tuneTimer = null;
      scheduleRetry(
        "This channel didn’t start. The stream is most likely off air — " +
          "the channel list includes it either way."
      );
    }, TUNE_TIMEOUT_MS);

    const clearTuneTimer = () => {
      if (tuneTimer !== null) {
        clearTimeout(tuneTimer);
        tuneTimer = null;
      }
    };

    const onPlaying = () => {
      clearTuneTimer();
      clearStallTimer();
      setLoading(false);
      setRebuffering(false);
      setNeedsGesture(false);
      // A channel that plays fine now shouldn't have its retry budget
      // dented by trouble from ten minutes ago -- only a run of failures
      // that never once reaches "playing" should count toward the cap.
      retryCountRef.current = 0;
    };

    /*
      Resuming (a pause, or anything else that leaves playback parked) lands
      back at the live cushion rather than wherever the pause left it.

      Without this, pausing was a way to silently fall arbitrarily far behind
      live with no way back except this -- there is no scrubber anymore to
      manually catch up with (see VideoChrome), so automatic is the only way
      "back to live" happens at all now. The threshold matches `isBehind`
      below: the cushion itself is not behind, only meaningfully past it.

      Also covers the initial start on native HLS (Safari): unlike the
      hls.js path, that one has no explicit seek-to-edge before playback
      begins, so the first `play` can legitimately find itself behind too.
    */
    const onPlay = () => {
      if (video.seekable.length === 0) return;
      const edge = video.seekable.end(video.seekable.length - 1);
      if (edge - video.currentTime > LIVE_SYNC_SECONDS + 4) {
        setRebuffering(true);
        goLive();
      }
    };
    // Mid-stream stalls get the spinner back rather than a frozen frame, and
    // are kept distinct from the initial tune so the timeout above doesn't
    // treat a brief rebuffer as a dead channel.
    /*
      A stall gets a deadline, not just a spinner.

      Jellyfin's playlist is EVENT-type: it grows and never slides, so a player
      that catches up to the encoder is parked at a position that will never
      receive more data. Waiting there is what produced "it buffers and tries
      to reconnect" -- hls.js eventually tears the stream down and restarts it,
      which is both slow and visible.

      Moving back to the live cushion fixes it in one seek. The timer is
      cleared by `playing`, so ordinary rebuffering that resolves on its own
      never triggers it.
    */
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const clearStallTimer = () => {
      if (stallTimer !== null) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    };

    const onWaiting = () => {
      setRebuffering(true);
      if (stallTimer !== null) return;
      stallTimer = setTimeout(() => {
        stallTimer = null;
        // Only if still stalled: `playing` clears this, so reaching here means
        // the wait did not resolve.
        if (video.paused || video.readyState >= 3) return;
        // Someone watching a replay is meant to stay there. A stall while
        // scrubbed back is ordinary buffering, not a reason to move them.
        if (stayBehindRef.current) return;
        // forwardOnly: recovery must never rewind (see seekToLiveEdge).
        if (seekToLiveEdge(video, { forwardOnly: true })) {
          void video.play().catch(() => {});
        }
      }, EDGE_STALL_RECOVERY_MS);
    };

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
          // Not a failure -- the browser is waiting for a click, and nothing
          // about retrying would change that, so this doesn't touch the
          // retry budget at all.
          setNeedsGesture(true);
          setLoading(false);
        } else {
          scheduleRetry("Playback couldn’t start.");
        }
      });
    };
    // How far behind the live edge we are, recomputed as playback moves. This
    // is what replaces a progress bar: a broadcast has no start and no end, so
    // "37% through" is meaningless, but "2 minutes behind live" is not.
    const onTimeUpdate = () => {
      if (video.seekable.length === 0) {
        setBehind(null);
        return;
      }
      const last = video.seekable.length - 1;
      const edge = video.seekable.end(last);
      const behindNow = Math.max(0, edge - video.currentTime);
      setBehind(behindNow);

      /*
        Corrects drift during otherwise-healthy playback, not just on a pause
        or a hard stall.

        Without this, "slightly behind" only ever gets worse: normal playback
        runs at 1x while the encoder keeps producing segments, so any
        buffering along the way -- even too brief to fire `waiting` -- is time
        that's gone for good unless something actively seeks forward. Over a
        long session that drift only accumulates, and the LIVE badge sits grey
        (see VideoChrome) for longer than the cushion actually requires.

        Same threshold as `isBehind` below and the resume check in `onPlay`,
        so the badge and this correction agree on what "behind" means. The
        cooldown exists because this runs on every timeupdate tick (multiple
        times a second) while behind, and a seek that hasn't resolved yet
        must not be re-issued on the next tick.
      */
      if (behindNow > LIVE_SYNC_SECONDS + 4 && !stayBehindRef.current) {
        const now = Date.now();
        if (now - lastCatchUpAt > CATCH_UP_COOLDOWN_MS) {
          lastCatchUpAt = now;
          setRebuffering(true);
          goLive();
        }
      }
    };

    /*
      Reads intent from where the playhead ends up after any seek. Inside the
      cushion means "live"; clearly outside it means the viewer went looking
      for something and should be left there.
    */
    const onSeeked = () => {
      if (video.seekable.length === 0) return;
      const edge = video.seekable.end(video.seekable.length - 1);
      stayBehindRef.current = edge - video.currentTime > LIVE_SYNC_SECONDS + 4;
    };

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("play", onPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);

    if (supportsNativeHls()) {
      video.src = src;
      startPlayback();
    } else if (Hls.isSupported()) {
      hls = new Hls({
        /*
          Jellyfin serves an EVENT playlist that grows and never slides:

              #EXT-X-PLAYLIST-TYPE:EVENT
              #EXT-X-MEDIA-SEQUENCE:0     <- never advances
              4 segments -> 23 over 12s

          So the "live edge" keeps moving away while the start stays at zero,
          and a player that begins near the front plays a finite-looking
          timeline, drifts further behind every minute, and stalls when it
          finally meets the encoder. That is exactly the reported symptom:
          starts somewhere, runs to an end, buffers, reconnects.

          Expressed in SECONDS rather than segment counts, deliberately. The
          count-based settings multiply by target duration, and the segment
          length is now 1s rather than 3s (mediabox-infra#78) -- so the old
          liveSyncDurationCount: 3 silently went from nine seconds of safety
          to three, which is not enough to absorb a hiccup on a residential
          IPTV feed.
        */
        liveSyncDuration: LIVE_SYNC_SECONDS,
        /*
          liveMaxLatencyDuration is deliberately NOT set.

          It makes hls.js seek to the live edge on its own once the playhead
          falls further behind than the limit -- which is precisely what a
          viewer does on purpose when they scrub back to re-watch something.
          With it set, going back thirty seconds was quietly undone a moment
          later by the library, and no amount of intent-tracking in this
          component could win against it.

          Falling behind unintentionally is handled by the stall recovery
          below, which knows the difference because it checks stayBehindRef.
        */
        backBufferLength: BACK_BUFFER_SECONDS,
        enableWorker: true,
        lowLatencyMode: false,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Start at the edge, not wherever the playlist happens to begin.
        // With an EVENT playlist hls.js has no sliding window to infer the
        // live point from, so it is set explicitly.
        seekToLiveEdge(video);
        startPlayback();
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        clearTuneTimer();
        scheduleRetry(
          data.response?.code === 503
            ? "This channel couldn’t be tuned. The stream may be offline."
            : "Playback failed."
        );
      });
    } else {
      clearTuneTimer();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("This browser can’t play live streams.");
       
      setLoading(false);
    }

    return () => {
      clearTuneTimer();
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      clearStallTimer();
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
    // retryToken is read nowhere in the body above -- it's listed here purely
    // so scheduleRetry's setRetryToken(t => t + 1) forces this effect to
    // re-run, giving a retry the same teardown-and-restart a channel change
    // already gets.
  }, [channelId, goLive, retryToken]);

  /*
    "Behind live" means meaningfully behind, not merely cushioned.

    Playback deliberately sits LIVE_SYNC_SECONDS back from the edge so a hiccup
    has something to play through, so the threshold has to clear that or the
    player would permanently describe its own healthy state as behind. Set just
    above the cushion rather than far above it: at 20s a viewer who had scrubbed
    back fifteen seconds was still told they were live.
  */
  const isBehind = behind !== null && behind > LIVE_SYNC_SECONDS + 4;

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
            live={{ atLive: !isBehind }}
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
