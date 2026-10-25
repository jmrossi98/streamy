"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { supportsNativeHls } from "@/lib/hlsSupport";
import { liveSeekTarget } from "@/lib/liveTimeline";
import { EdgeArrivalTracker, behindThreshold, cushionForGap, cushionShortfall } from "@/lib/liveCushion";
import { usePlayerChrome } from "@/lib/usePlayerChrome";
import { VideoChrome } from "@/components/VideoChrome";
import { Button } from "@/components/ui";
import { usePlaybackTelemetry } from "@/lib/usePlaybackTelemetry";

type Props = {
  channelId: string;
  channelName: string;
  /** Shown under the title -- what's on now, when the guide knows. */
  nowPlaying?: string | null;
  /**
   * Called once the retries are spent and the channel is given up on. A game
   * page uses it to move on to the next channel that might carry the game,
   * rather than leave the viewer on an error with other options unused.
   *
   * `reason` says why, so the caller can react: "busy" means the provider had
   * no free line (a 503 from the tuner) -- a sign its other channels won't work
   * either -- and "offline" means the stream itself never delivered.
   */
  onGiveUp?: (reason?: "busy" | "offline") => void;
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
 *
 * 20s since 2026-10-16. With 1s segments (mediabox-infra#78) and the probe
 * capped, a tune measured end to end delivered its first segment in 2.6-5.3s
 * and 8s of video by 6-8s. 60s was then mostly a spinner over dead feeds --
 * times four with the retries, ~4 minutes before a game page tried the next
 * option. 20s is still 2-3x the slowest measured tune.
 */
//
// 30s since 2026-10-18: under load (an Intro Skipper scan on mediabox's 4
// cores) Jellyfin took up to 14.4s for the first playlist alone, and a tune
// that delivered at ~21s showed "didn't start" over a game that was playing.
const TUNE_TIMEOUT_MS = 30_000;

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
// 4 since 2026-10-16 (was 8): playback starts once 4s are buffered rather
// than 8, which was most of the wait a viewer felt after tuning. Still four
// 1s segments of cushion against an upstream hiccup.
const LIVE_SYNC_SECONDS = 4;

/**
 * The cushion each channel grew to this page session (liveCushion.ts), so
 * re-tuning a clumpy channel starts far enough back instead of re-learning
 * it through another stall.
 */
const learnedCushion = new Map<string, number>();

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
 * Capped at three: a genuinely dead channel (provider offline, not a
 * transient hiccup) must still end in the real error rather than retry
 * forever, and each attempt already costs up to TUNE_TIMEOUT_MS if the
 * failure is a hang rather than a fast error.
 *
 * The waits add up to just over a minute on purpose. When Jellyfin's
 * pre-tune probe of a channel disconnects from Dispatcharr the instant the
 * provider's feed starts flowing -- a slow-starting feed, 2026-10-25, the
 * first tune of a just-added "UK: EPL LEEDS" -- Dispatcharr treats the
 * broken pipe as a stream failure, tears the channel down and refuses every
 * new client for 60 s ("Channel is stopping, retry shortly", its stopping
 * marker's lifetime). Retries 3, 6 and 9 s apart all landed inside that
 * window, the player gave up, and the game page fell back to a guess; the
 * same channel tuned first time 65 s later. So the last retry waits the
 * marker out.
 */
const MAX_RETRIES = 3;
/** The wait before retry n (1-based), in ms. */
const RETRY_BACKOFF_MS = [5_000, 20_000, 40_000];

/**
 * How long hls.js waits on one 1 s segment. A fetch that has not started
 * answering in 5 s is stuck, not slow (the proxy streams the file through as
 * Jellyfin writes it), so it is failed and retried rather than left to the
 * 10 s / 120 s defaults, which hold the whole buffer hostage to one segment.
 */
const LIVE_FRAG_LOAD_POLICY = {
  maxTimeToFirstByteMs: 5_000,
  maxLoadTimeMs: 15_000,
  timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
  errorRetry: { maxNumRetry: 3, retryDelayMs: 1_000, maxRetryDelayMs: 8_000 },
};

/** How long hls.js waits on a live playlist -- see the Hls config below. */
const LIVE_PLAYLIST_LOAD_POLICY = {
  maxTimeToFirstByteMs: TUNE_TIMEOUT_MS,
  maxLoadTimeMs: TUNE_TIMEOUT_MS,
  timeoutRetry: { maxNumRetry: 1, retryDelayMs: 0, maxRetryDelayMs: 0 },
  errorRetry: { maxNumRetry: 2, retryDelayMs: 1_000, maxRetryDelayMs: 8_000 },
};

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
  opts: { forwardOnly?: boolean } = {},
  cushion: number = LIVE_SYNC_SECONDS
): boolean {
  if (video.seekable.length === 0) return false;
  const edge = video.seekable.end(video.seekable.length - 1);
  const start = video.seekable.start(0);

  // The decision lives in liveTimeline.ts so it can be tested without a
  // browser -- it is the logic whose unconditional version rewound the
  // playhead on every stall and replayed the same seconds indefinitely.
  const target = liveSeekTarget(video.currentTime, start, edge, cushion, opts);
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
export function LivePlayer({ channelId, channelName, nowPlaying, onGiveUp }: Props) {
  // Read through a ref so a new callback each render doesn't re-run the tune effect.
  const onGiveUpRef = useRef(onGiveUp);
  /** Set when the last fatal error was a 503 -- the provider had no free line. */
  const lastFailWasBusyRef = useRef(false);
  useEffect(() => {
    onGiveUpRef.current = onGiveUp;
  }, [onGiveUp]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Playback started and then stalled, as opposed to never having started. */
  const [rebuffering, setRebuffering] = useState(false);
  /** The stream is ready but the browser won't start it even muted without a tap (iPhone Low Power Mode). */
  const [needsTap, setNeedsTap] = useState(false);
  /** Playing, but muted because the browser won't allow sound until the viewer taps. */
  const [soundBlocked, setSoundBlocked] = useState(false);
  /**
   * Whether a blocked autoplay forced this tune to start muted.
   *
   * A live channel is meant to just start -- nothing here should ever ask a
   * viewer to click play. Muted autoplay is exempt from the gesture
   * requirement in every major browser, so a blocked attempt retries muted
   * instead of surfacing a prompt (see startPlayback and resumePlayback).
   * This flags that it happened, so onPlaying knows to unmute the instant
   * real playback actually starts rather than leaving the channel silent.
   */
  const autoMutedRef = useRef(false);
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
  // Every attempt reported to the admin Viewers panel, retries included.
  const { reportRetry } = usePlaybackTelemetry(videoRef, {
    kind: "live",
    title: channelName,
    error,
    attempt: retryToken,
    startOnMount: true,
  });
  const reportRetryRef = useRef(reportRetry);
  useEffect(() => {
    reportRetryRef.current = reportRetry;
  }, [reportRetry]);
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
  /*
    Current cushion and "behind" threshold for this tune. Start at the
    fast-tune default (or what this channel taught us earlier) and grow when
    the feed turns out to arrive in clumps -- see liveCushion.ts.
  */
  const cushionRef = useRef(LIVE_SYNC_SECONDS);
  const behindLimitRef = useRef(LIVE_SYNC_SECONDS + 4);
  const [behindLimit, setBehindLimit] = useState(LIVE_SYNC_SECONDS + 4);

  // No knownDurationSeconds: a broadcast has no runtime to pin the bar to.
  const chrome = usePlayerChrome(videoRef, containerRef);

  /**
   * Resumes playback after an automatic seek, retrying muted the same way
   * startPlayback's own first attempt does when autoplay is blocked -- see
   * the comment there for why, and autoMutedRef's for what tells onPlaying
   * to undo it.
   *
   * Silently swallowing the rejection instead -- what both call sites below
   * used to do, with no muted retry either -- was the actual bug behind
   * "reconnecting forever, then a generic failure": the player kept
   * re-issuing play() the same blocked way, nothing recovered, and
   * eventually an unrelated hls.js watchdog gave up and reported a stream
   * failure that was never the real problem. A muted retry failing too is
   * left to that same existing machinery (onWaiting's own timer, hls.js's
   * fatal handler) rather than handled again here.
   */
  const resumePlayback = useCallback((v: HTMLVideoElement) => {
    v.play().catch((err: unknown) => {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "AbortError") {
        autoMutedRef.current = true;
        v.muted = true;
        void v.play().catch(() => {});
      }
    });
  }, []);

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
    if (!seekToLiveEdge(v, {}, cushionRef.current)) return;
    resumePlayback(v);
  }, [resumePlayback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // A genuine channel change gets a fresh retry budget; a retry of the
    // same channel (channelId unchanged, only retryToken bumped) keeps
    // whatever count it already had, which is the thing MAX_RETRIES bounds.
    if (retryChannelIdRef.current !== channelId) {
      retryChannelIdRef.current = channelId;
      retryCountRef.current = 0;
      lastFailWasBusyRef.current = false;
      // error and loading are otherwise only ever set once and never
      // cleared -- reasonable for a single tune, wrong the moment a caller
      // (GameChannelPicker's channel switcher) reuses one LivePlayer
      // instance across channels. Without this, a channel that had already
      // failed left its "Playback failed." text on screen forever: `!error`
      // gates every other branch below, including the one that shows a new
      // tune actually progressing, so a switch away from a dead channel
      // looked like it silently did nothing even though a fresh tune was
      // genuinely starting behind that stale message.
      setError(null);
      setLoading(true);
      setNeedsTap(false);
      setSoundBlocked(false);
    }

    /*
      Throttle for the continuous drift correction in onTimeUpdate below.
      Plain closure state, not a ref: written and read synchronously in the
      same handler, never across a render.
    */
    let lastCatchUpAt = 0;
    const CATCH_UP_COOLDOWN_MS = 4_000;
    /** A rewind to apply a grown cushion is not repeated inside this; growth comes a gap at a time. */
    const REWIND_COOLDOWN_MS = 20_000;
    let lastRewindAt = 0;

    const arrivals = new EdgeArrivalTracker();
    const startCushion = learnedCushion.get(channelId) ?? LIVE_SYNC_SECONDS;
    cushionRef.current = startCushion;
    behindLimitRef.current = behindThreshold(startCushion, 0);
    setBehindLimit(behindLimitRef.current);

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
    const scheduleRetry = (finalError: string, retryable = true) => {
      if (!retryable || retryCountRef.current >= MAX_RETRIES) {
        setError(finalError);
        setLoading(false);
        onGiveUpRef.current?.(lastFailWasBusyRef.current ? "busy" : "offline");
        return;
      }
      retryCountRef.current += 1;
      reportRetryRef.current(finalError);
      setTimeout(
        () => {
          setRetryToken((t) => t + 1);
        },
        RETRY_BACKOFF_MS[Math.min(retryCountRef.current, RETRY_BACKOFF_MS.length) - 1]
      );
    };

    // Nothing here fires if the channel is dead, which is the whole problem:
    // the timer is the only thing that can tell the difference between "still
    // tuning" and "never going to start".
    let tuneTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      tuneTimer = null;
      scheduleRetry(
        "This channel didn’t start. The stream is most likely off air - " +
          "the channel list includes it either way.",
        // With somewhere else to go (a game page's other options), a feed that
        // sent nothing in 20s is skipped now: a dead event feed does not come
        // back on a retry, and retrying three times was minutes of spinner
        // before the next option got a turn.
        !onGiveUpRef.current
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
      setNeedsTap(false);
      // It plays, so whatever said it wouldn't was wrong: a picture that
      // arrived just after the tune timer gave up left "This channel didn't
      // start" over a game that was playing (2026-10-18).
      setError(null);
      // Undoes the muted fallback the instant real playback is confirmed --
      // not unconditionally, so this never fights a viewer's own deliberate
      // mute (toggleMute), only the one this component itself forced.
      if (autoMutedRef.current) {
        /*
          Sound back on if the browser allows it. Without a recent tap it
          doesn't: unmuting then makes Chrome and Safari *pause* the video,
          which used to leave an autoplayed channel frozen. So check, and if
          it paused, carry on muted and offer sound instead.
        */
        video.muted = false;
        setTimeout(() => {
          if (!video.paused) {
            autoMutedRef.current = false;
            setSoundBlocked(false);
            return;
          }
          video.muted = true;
          void video.play().catch(() => {});
          setSoundBlocked(true);
        }, 0);
      }
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
      if (edge - video.currentTime > behindLimitRef.current) {
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
    /** Armed when Safari refuses the first play(); see startPlayback. */
    let onCanPlay: (() => void) | null = null;

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
        if (seekToLiveEdge(video, { forwardOnly: true }, cushionRef.current)) {
          resumePlayback(video);
        }
      }, EDGE_STALL_RECOVERY_MS);
    };

    /**
     * A rejected play() used to just clear the spinner, leaving a black
     * rectangle with no text -- the original reported symptom. A live
     * channel has no business asking anyone to click play, so a blocked
     * autoplay (missing a user gesture) retries muted instead of surfacing a
     * prompt -- muted autoplay is exempt from that requirement in every
     * major browser. onPlaying unmutes the instant real playback starts.
     * Anything else, or the muted retry failing too, is a real failure and
     * goes through the normal retry-with-backoff path.
     */
    /*
      A refused play() is not a dead channel.

      Safari on iPhone refuses play() while a live stream is still loading
      (AbortError), and without a tap (NotAllowedError) -- muted or not, until
      there is something to play. This used to re-tune on that, and re-tuning
      cancels the playlist request Jellyfin was still preparing (it holds it
      ~7s, until three segments exist), so the next attempt was refused the
      same way. On 2026-10-17 an iPhone looped like that for every channel it
      tried -- master, playlist cancelled within 1-3s, stop, again -- and never
      played anything.

      So a refusal waits for `canplay` and tries once more, and if that is
      refused too, asks for a tap. Whether the channel is actually dead is
      still decided by the tune timer and hls.js's own errors.
    */
    const isRefusal = (err: unknown) => {
      const name = err instanceof Error ? err.name : "";
      return name === "NotAllowedError" || name === "AbortError";
    };
    const tryPlay = (): Promise<void> =>
      video.play().catch((err: unknown) => {
        if (!isRefusal(err)) throw err;
        autoMutedRef.current = true;
        video.muted = true;
        return video.play();
      });
    const startPlayback = () => {
      tryPlay().catch((err: unknown) => {
        if (!isRefusal(err)) {
          clearTuneTimer();
          scheduleRetry("Playback couldn’t start.");
          return;
        }
        if (onCanPlay) return;
        // No tap asked for here: tryPlay has already fallen back to muted,
        // which every browser autoplays. A refusal at this point is a play()
        // interrupted while the stream loads (Chrome does it on most tunes),
        // so try again once there is something to play. Only if that fails
        // too -- iPhone Low Power Mode blocks even muted autoplay -- is a tap
        // the one thing left (2026-10-17: offering it earlier put "Tap to
        // play" over "Tuning..." on desktop).
        onCanPlay = () => {
          video.removeEventListener("canplay", onCanPlay!);
          tryPlay().catch(() => {
            // The stream is there; only the browser is holding out for a tap.
            clearTuneTimer();
            setLoading(false);
            setNeedsTap(true);
          });
        };
        video.addEventListener("canplay", onCanPlay);
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

      // Learn the feed's rhythm before judging drift: the tick a clump lands
      // is exactly when behindNow jumps, and it must be read against a
      // threshold that already knows about that clump.
      const now = Date.now();
      if (arrivals.observe(edge, now) !== null) {
        const gap = arrivals.longestGap(now);
        const next = cushionForGap(gap, startCushion);
        const limit = behindThreshold(next, gap);
        if (next !== cushionRef.current || limit !== behindLimitRef.current) {
          cushionRef.current = next;
          behindLimitRef.current = limit;
          setBehindLimit(limit);
          if (next > LIVE_SYNC_SECONDS) learnedCushion.set(channelId, next);
          // hls.js keeps its own idea of where "live" is (liveSyncPosition,
          // from liveSyncDuration at tune time) and seeks there by itself
          // when the playhead drops out of the playlist window. That must
          // track the learned cushion, or such a seek lands 4 s from the
          // edge -- straight into the next gap.
          if (hls) hls.targetLatency = next;
        }
        // A cushion that grew is only a number until the playhead sits that
        // far from the edge: stall recovery never rewinds, so apply it here,
        // once per growth, by moving back the few seconds it lacks
        // (cushionShortfall). Not for a viewer who scrubbed back on purpose.
        const short = cushionShortfall(behindNow, next);
        if (short > 0 && !stayBehindRef.current && !video.paused && now - lastRewindAt > REWIND_COOLDOWN_MS) {
          lastRewindAt = now;
          seekToLiveEdge(video, {}, next);
        }
      }

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
      if (behindNow > behindLimitRef.current && !stayBehindRef.current) {
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
      stayBehindRef.current = edge - video.currentTime > behindLimitRef.current;
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
        liveSyncDuration: startCushion,
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
        /*
          A hole in the buffer hls.js steps over instead of stalling on.
          Default 0.1 s. Segment joins on these feeds and ffmpeg's dup-frame
          fills (strong8k jumps 7.7 s every couple of minutes, 2026-10-25)
          leave slightly bigger seams, and hls.js only skips a hole up to this
          size -- anything larger is a stall until the recovery above moves
          the playhead, six seconds later.
        */
        maxBufferHole: 0.5,
        fragLoadPolicy: { default: LIVE_FRAG_LOAD_POLICY },
        /*
          Jellyfin holds the first live playlist until three segments exist --
          7.6s measured on 2026-10-17 -- and hls.js gives up at 10s by default.
          A timeout cancels the request, and Jellyfin stops the transcode on a
          cancelled request, so a slow tune never got a second chance. Same
          budget as the tune timer, which stays the judge of a dead channel.
        */
        manifestLoadPolicy: { default: LIVE_PLAYLIST_LOAD_POLICY },
        playlistLoadPolicy: { default: LIVE_PLAYLIST_LOAD_POLICY },
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Start at the edge, not wherever the playlist happens to begin.
        // With an EVENT playlist hls.js has no sliding window to infer the
        // live point from, so it is set explicitly.
        seekToLiveEdge(video, {}, startCushion);
        startPlayback();
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        clearTuneTimer();
        const busy = data.response?.code === 503;
        lastFailWasBusyRef.current = busy;
        scheduleRetry(
          busy
            ? "This channel couldn’t be tuned — the provider’s lines are all in use."
            : "Playback failed."
        );
      });
    } else {
      clearTuneTimer();
       
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
      if (onCanPlay) video.removeEventListener("canplay", onCanPlay);
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
  }, [channelId, goLive, resumePlayback, retryToken]);

  /*
    "Behind live" means meaningfully behind, not merely cushioned.

    Playback deliberately sits LIVE_SYNC_SECONDS back from the edge so a hiccup
    has something to play through, so the threshold has to clear that or the
    player would permanently describe its own healthy state as behind. Set just
    above the cushion rather than far above it: at 20s a viewer who had scrubbed
    back fifteen seconds was still told they were live.
  */
  const isBehind = behind !== null && behind > behindLimit;

  return (
    <div className="w-full">
      <div ref={containerRef} className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
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
          onClick={chrome.surfaceClick}
          onMouseMove={chrome.revealControls}
          /*
            absolute inset-0 h-full w-full, not aspect-video on the video
            itself: the aspect ratio now belongs to the container above, and
            the video just fills whatever box that container currently is.

            Those are the same box in normal play -- the container is 16:9,
            so is the video -- but not in fullscreen. requestFullscreen() is
            called on the *container* (usePlayerChrome), and the browser's
            fullscreen sizing forces that container to fill the real screen
            regardless of its own aspect-ratio (aspect-ratio only resolves a
            dimension left auto; fullscreen sets both explicitly, so it has
            no effect there). A video still sized by aspect-video kept
            rendering at 16:9 inside that now-taller box, leaving a real gap
            below the picture -- which is exactly where VideoChrome's bottom
            bar sits, since it fills the *container*, not the video. Reported
            live as a black bar under the picture with the controls stranded
            in it. object-contain does the letterboxing now, inside the
            video element itself, so the video and its container are always
            the same box and VideoChrome's overlay always lines up with what
            is actually on screen.
          */
          className="absolute inset-0 h-full w-full bg-black object-contain"
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

        {loading && !error && !needsTap && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner label="Tuning…" />
          </span>
        )}
        {/* Rebuffering is drawn over the frozen frame rather than replacing it,
            and only once playback has started -- otherwise a stall during the
            initial tune would stack two spinners. No separate "press play"
            state: a blocked autoplay retries muted instead (see
            startPlayback/resumePlayback), so there is nothing here that ever
            needs a click. */}
        {rebuffering && !loading && !error && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
            <Spinner label="Reconnecting…" />
          </span>
        )}
        {/* Not blocking: the picture plays on underneath, muted. */}
        {soundBlocked && !needsTap && !error && (
          <span className="absolute left-3 top-3 z-10">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                v.muted = false;
                autoMutedRef.current = false;
                setSoundBlocked(false);
                void v.play().catch(() => {});
              }}
            >
              Tap for sound
            </Button>
          </span>
        )}
        {needsTap && !error && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Button
              variant="primary"
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                setNeedsTap(false);
                // A tap is the gesture the browser was waiting for, so sound can come too.
                v.muted = false;
                autoMutedRef.current = false;
                void v.play().catch(() => setNeedsTap(true));
              }}
            >
              Tap to play
            </Button>
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
