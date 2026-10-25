"use client";

import { markShowWatched } from "@/lib/showResumeFreshness";
import { useFreshResume, useResumeRecheck } from "@/lib/useFreshResume";
import { useState, useEffect, useCallback, useRef, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VideoChrome } from "./VideoChrome";
import { type SubtitleOption } from "./SubtitleSelector";
import { PlaybackOptionsMenu, type AudioOption } from "./PlaybackOptionsMenu";
import { Artwork, Button } from "./ui";
import { usePlayerEngine } from "@/lib/usePlayerEngine";
import { usePageScrollLock } from "@/lib/usePageScrollLock";
import { usePlaybackTelemetry } from "@/lib/usePlaybackTelemetry";
import type { EpisodePlayback } from "@/lib/episodePlayback";
import {
  isFinished,
  startPoint,
  CREDITS_COUNTDOWN_SECONDS,
  inCredits,
  NO_SEGMENTS,
  shouldAskStillWatching,
  skipOfferAt,
  type EpisodeSegments,
} from "@/lib/episodeSegmentRules";
import {
  pendingNotice,
  pendingSource,
  SOURCE_POLL_EVERY_MS,
  SOURCE_POLL_FOR_MS,
  type PendingSource,
} from "@/lib/pendingSourceRules";

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
  /** The episode after this one; the player rolls on to it by itself. */
  nextEpisodeHref?: string | null;
  nextEpisodeLabel?: string;
  videoUrl?: string | null;
  closeHref?: string;
  onClose?: () => void;
  /** Subtitle tracks Jellyfin already has for this episode -- omitted (or empty) hides the control entirely. */
  subtitleTracks?: SubtitleOption[];
  /** Skip straight to the transcode instead of attempting direct play first
   * -- see the movie player's WatchPlayerProps for the full rationale. */
  forceTranscode?: boolean;
  /** Subtitle track to switch on at start (English under foreign audio). */
  defaultSubtitle?: number | null;
  /** The title's audio tracks, for the audio/subtitles menu. */
  audioTracks?: AudioOption[];
  /** The track playing at start. */
  defaultAudio?: number | null;
  /** Intro/recap/credits times when the caller already has them; otherwise asked for. */
  segments?: EpisodeSegments | null;
};

type Next = { seasonNumber: number; episodeNumber: number; href: string; label: string };

/** The episode being played, whichever way it was reached. */
type Episode = {
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string;
  runtimeMinutes: number | null;
  videoUrl: string | null;
  subtitleTracks: SubtitleOption[];
  forceTranscode: boolean;
  defaultSubtitle: number | null;
  audioTracks: AudioOption[];
  defaultAudio: number | null;
  progressSeconds: number;
  segments: EpisodeSegments | null;
  next: Next | null;
};

function parseNext(href: string | null | undefined, label: string | undefined): Next | null {
  const m = href?.match(/\/episode\/(\d+)\/(\d+)/);
  if (!href || !m) return null;
  return { seasonNumber: Number(m[1]), episodeNumber: Number(m[2]), href, label: label ?? `S${m[1]} E${m[2]}` };
}

/**
 * The episode player. A frame that stays put for the whole viewing, holding
 * one player per episode: rolling on to the next episode swaps the player
 * inside it rather than going to that episode's page. Going to the page
 * replaced the element in fullscreen, which is what dropped the viewer out of
 * fullscreen at every episode (and made them click through). The frame is
 * what fullscreen enlarges, so it carries straight on.
 *
 * Each episode still gets a fresh engine (keyed by episode): the engine holds
 * a lot of per-title state -- the transcode fallback, its play session, the
 * chosen audio -- and starting clean is far safer than resetting all of it.
 */
export function EpisodePlayer(props: EpisodePlayerProps) {
  const { showId, showName, backdropUrl, closeHref, onClose, autoPlay = true } = props;
  const router = useRouter();
  const frameRef = useRef<HTMLDivElement>(null);
  usePageScrollLock();

  const fromProps: Episode = {
    seasonNumber: props.seasonNumber,
    episodeNumber: props.episodeNumber,
    episodeName: props.episodeName,
    runtimeMinutes: props.runtimeMinutes ?? null,
    videoUrl: props.videoUrl ?? null,
    subtitleTracks: props.subtitleTracks ?? [],
    forceTranscode: props.forceTranscode ?? false,
    defaultSubtitle: props.defaultSubtitle ?? null,
    audioTracks: props.audioTracks ?? [],
    defaultAudio: props.defaultAudio ?? null,
    progressSeconds: props.initialProgressSeconds,
    segments: props.segments ?? null,
    next: parseNext(props.nextEpisodeHref, props.nextEpisodeLabel),
  };
  // Episodes reached by rolling on, tied to the episode the caller asked
  // for: when the caller picks another one (the show page's own episode
  // list), that wins again.
  const propsKey = `${props.seasonNumber}-${props.episodeNumber}`;
  const [rolled, setRolled] = useState<{ from: string; episode: Episode } | null>(null);
  const episode = rolled && rolled.from === propsKey ? rolled.episode : fromProps;
  const continuing = !!rolled && rolled.from === propsKey;

  // The next episode's playback, asked for once this one is under way so
  // rolling on is instant.
  const nextRef = useRef<{ key: string; data: Promise<EpisodePlayback | null> } | null>(null);
  const loadNext = useCallback(
    (next: Next) => {
      const key = `${next.seasonNumber}-${next.episodeNumber}`;
      if (nextRef.current?.key !== key) {
        const data = fetch(`/api/stream/episode/${showId}/${next.seasonNumber}/${next.episodeNumber}/playback`, { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<EpisodePlayback>) : null))
          .catch(() => null);
        nextRef.current = { key, data };
      }
      return nextRef.current.data;
    },
    [showId]
  );
  useEffect(() => {
    const next = episode.next;
    if (!next) return;
    const t = setTimeout(() => void loadNext(next), 20_000);
    return () => clearTimeout(t);
  }, [episode.next, loadNext]);

  // No file to play. Sonarr imports a file and Jellyfin indexes it a minute
  // or so later; a click in between found nothing and the page said "Not
  // downloaded yet" for Clone High (2023) S1E1 fifteen seconds after its
  // import (2026-10-19). While there is no source: find out which case this
  // is for the notice, and keep asking for the file, starting it the moment
  // Jellyfin has it -- the same swap rolling on to the next episode does.
  // See pendingSourceRules.ts.
  const [pending, setPending] = useState<PendingSource | null>(null);
  const { videoUrl: sourceUrl, seasonNumber: pendingSeason, episodeNumber: pendingEpisode } = episode;
  useEffect(() => {
    if (sourceUrl) return;
    let live = true;
    fetch(`/api/requests/tv?tmdbId=${encodeURIComponent(showId)}&season=${pendingSeason}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { statuses?: Record<number, { status?: string }> } | null) => {
        if (live) setPending(pendingSource(d?.statuses?.[pendingEpisode]?.status));
      })
      .catch(() => {
        if (live) setPending("missing");
      });
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > SOURCE_POLL_FOR_MS) {
        clearInterval(timer);
        return;
      }
      fetch(`/api/stream/episode/${showId}/${pendingSeason}/${pendingEpisode}/playback`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<EpisodePlayback>) : null))
        .then((data) => {
          if (live && data?.videoUrl) setRolled({ from: propsKey, episode: data });
        })
        .catch(() => {});
    }, SOURCE_POLL_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sourceUrl, showId, pendingSeason, pendingEpisode, propsKey]);

  // Episodes rolled on to with nobody touching anything (see shouldAskStillWatching).
  const unattendedRef = useRef(0);
  const [askStillWatching, setAskStillWatching] = useState(false);
  useEffect(() => {
    const touched = () => {
      unattendedRef.current = 0;
    };
    window.addEventListener("pointerdown", touched);
    window.addEventListener("keydown", touched);
    return () => {
      window.removeEventListener("pointerdown", touched);
      window.removeEventListener("keydown", touched);
    };
  }, []);

  const advancingRef = useRef(false);
  const advance = useCallback(
    async (how: "auto" | "manual") => {
      const next = episode.next;
      if (!next || advancingRef.current) return;
      if (how === "auto") {
        if (shouldAskStillWatching(unattendedRef.current)) {
          setAskStillWatching(true);
          return;
        }
        unattendedRef.current += 1;
      }
      advancingRef.current = true;
      const data = await loadNext(next);
      advancingRef.current = false;
      if (!data) {
        // Could not learn about it here; the episode's own page still can.
        router.push(next.href);
        return;
      }
      setAskStillWatching(false);
      setRolled({ from: propsKey, episode: data });
      // The address follows along, so a refresh, Back or a shared link lands
      // on this episode. Replaced, not pushed: one entry for the viewing.
      window.history.replaceState(window.history.state, "", next.href);
    },
    [episode.next, loadNext, propsKey, router]
  );

  return (
    <div
      ref={frameRef}
      // Fixed full-viewport always -- both callers (the standalone episode
      // page and ShowContent's click-to-play overlay) use this as the whole
      // screen. inset-0 alone, no h-screen/w-screen: those are a static
      // 100vh/100vw snapshot, and mobile browsers resize the real viewport
      // as their address bar collapses, which left the scrubber below the
      // fold. And no `relative` alongside `fixed`: Tailwind orders position
      // utilities so `relative` wins regardless of class order, collapsing
      // the frame to ~0px at the top of the page.
      className="bg-black fixed inset-0 z-30"
    >
      <EpisodeView
        key={`${episode.seasonNumber}-${episode.episodeNumber}`}
        showId={showId}
        showName={showName}
        backdropUrl={backdropUrl}
        episode={episode}
        autoPlay={autoPlay || continuing}
        continuing={continuing}
        pending={pending}
        closeHref={closeHref}
        onClose={onClose}
        frameRef={frameRef}
        onAdvance={advance}
      />
      {askStillWatching && episode.next && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-black/85 px-6 text-center">
          <p className="text-xl font-semibold text-white">Still watching {showName}?</p>
          <p className="text-sm text-white/70">Up next: {episode.next.label}</p>
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                unattendedRef.current = 0;
                void advance("manual");
              }}
            >
              Keep watching
            </Button>
            {closeHref ? (
              <Link href={closeHref} className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10">
                I&apos;m done
              </Link>
            ) : (
              <Button variant="secondary" size="md" onClick={onClose}>
                I&apos;m done
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type EpisodeViewProps = {
  showId: string;
  showName: string;
  backdropUrl: string;
  episode: Episode;
  autoPlay: boolean;
  continuing: boolean;
  /** Why there is no source yet, once known (see pendingSourceRules.ts). */
  pending: PendingSource | null;
  closeHref?: string;
  onClose?: () => void;
  frameRef: RefObject<HTMLDivElement | null>;
  onAdvance: (how: "auto" | "manual") => void;
};

/** One episode's player, inside EpisodePlayer's frame. */
function EpisodeView({
  showId,
  showName,
  backdropUrl,
  episode,
  autoPlay,
  continuing,
  pending,
  closeHref,
  onClose,
  frameRef,
  onAdvance,
}: EpisodeViewProps) {
  const {
    seasonNumber,
    episodeNumber,
    episodeName,
    runtimeMinutes,
    videoUrl,
    subtitleTracks,
    forceTranscode,
    defaultSubtitle,
    audioTracks,
    defaultAudio,
    next,
  } = episode;

  // The caller's segments, or asked for (the show page's overlay has none).
  const [fetchedSegments, setFetchedSegments] = useState<EpisodeSegments | null>(null);
  useEffect(() => {
    if (episode.segments || !videoUrl) return;
    let live = true;
    fetch(`${videoUrl}/segments`)
      .then((r) => (r.ok ? (r.json() as Promise<EpisodeSegments>) : null))
      .then((s) => {
        if (live && s) setFetchedSegments(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [episode.segments, videoUrl]);
  const segments = episode.segments ?? fetchedSegments ?? NO_SEGMENTS;

  // The page's resume point can be minutes old; this re-asks on open.
  const resumeQuery = videoUrl
    ? `showId=${encodeURIComponent(showId)}&season=${seasonNumber}&episode=${episodeNumber}`
    : null;
  const { seconds: resumeFrom, settled: resumeSettled } = useFreshResume(resumeQuery, episode.progressSeconds);
  const runtimeSeconds = runtimeMinutes ? runtimeMinutes * 60 : null;
  // A spot that finished the episode starts it over (see isFinished) --
  // including ones saved before finished episodes were saved as 0.
  const startFrom = startPoint(resumeFrom, runtimeSeconds, segments);

  // What the save below measures "finished" against: the file's own length
  // once known (TMDB's runtime is often a minute off), and the segments.
  const finishRef = useRef({ duration: runtimeSeconds, segments });
  useEffect(() => {
    finishRef.current.segments = segments;
  }, [segments]);

  // Stable across renders (see usePlayerEngine's saveProgress doc). A
  // finished episode is saved as 0 only on leaving the player: saving 0 while
  // it was still open -- paused in the credits, say -- had the resume recheck
  // pull the paused player back to the start (reported 2026-10-17).
  const saveProgress = useCallback((sec: number, opts?: { leaving: boolean }) => {
    markShowWatched(showId);
    const { duration, segments: segs } = finishRef.current;
    const progressSeconds = opts?.leaving && isFinished(sec, duration, segs) ? 0 : sec;
    fetch("/api/episode-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId, seasonNumber, episodeNumber, progressSeconds }),
      // Survives the page going away -- the save on leaving is the one that matters most.
      keepalive: true,
    }).catch(() => {});
  }, [showId, seasonNumber, episodeNumber]);

  const {
    hasSource,
    selectedSubtitle,
    setSelectedSubtitle,
    selectedAudio,
    selectAudio,
    playing,
    showOverlay,
    videoLoading,
    buffering,
    playbackError,
    needsHlsJs,
    transcoding,
    videoSrc,
    videoRef,
    containerRef,
    chrome,
    handlePlayClick,
    onVideoError,
    onVideoPlay,
  } = usePlayerEngine({
    videoUrl,
    initialProgressSeconds: startFrom,
    resumeSettled,
    runtimeMinutes,
    autoPlay,
    forceTranscode,
    defaultSubtitle,
    audioTracks,
    defaultAudio,
    subtitleTracks,
    identityKey: `${showId}-${seasonNumber}-${episodeNumber}`,
    saveProgress,
    fullscreenRef: frameRef,
    continuing,
  });
  usePlaybackTelemetry(videoRef, {
    kind: "episode",
    title: `${showName} S${seasonNumber}E${episodeNumber}`,
    error: playbackError ? "Playback failed" : null,
  });
  // Back to a paused player after watching elsewhere: pick up that spot.
  useResumeRecheck(resumeQuery, videoRef);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onDuration = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) finishRef.current.duration = v.duration;
    };
    onDuration();
    v.addEventListener("durationchange", onDuration);
    return () => v.removeEventListener("durationchange", onDuration);
  }, [videoRef]);

  const showVideo = playing && !showOverlay;
  const t = chrome.currentTime;
  const skip = showVideo ? skipOfferAt(t, segments) : null;

  // Credits: offer the next episode and roll on after a short count, unless
  // the viewer chose to watch them. The count holds while paused.
  const [watchCredits, setWatchCredits] = useState(false);
  const creditsCard = showVideo && !!next && !watchCredits && inCredits(t, segments, chrome.duration || null);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      onMouseMove={() => showVideo && chrome.revealControls()}
      onTouchStart={() => showVideo && chrome.surfaceTouchStart()}
    >
      <video
        ref={videoRef}
        // hls.js feeds the element itself via MSE -- setting src too would
        // fight it. Every other case (direct play, native Safari HLS) uses
        // the attribute normally.
        src={needsHlsJs || !videoSrc ? undefined : videoSrc}
        autoPlay={!needsHlsJs}
        playsInline
        controls={false}
        onClick={() => {
          if (!showVideo) return;
          chrome.surfaceClick();
        }}
        className={`absolute inset-0 w-full h-full object-contain ${showOverlay ? "invisible" : ""}`}
        aria-label={`${showName} - ${episodeName}`}
        onError={onVideoError}
        onPlay={onVideoPlay}
        onEnded={() => {
          // Straight on to the next episode -- the credits card already
          // offered it, and anyone who wanted to stop has had the chance.
          if (next) onAdvance("auto");
        }}
      >
        {subtitleTracks.map((st) => (
          <track key={st.index} kind="subtitles" src={`${videoUrl}/subtitles/${st.index}`} label={st.label} data-sub-index={st.index} />
        ))}
      </video>
      {showVideo && buffering && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span
            className="h-14 w-14 rounded-full border-4 border-white/25 border-t-white animate-spin"
            aria-label="Buffering"
          />
        </div>
      )}
      {showVideo && (
        <VideoChrome
          title={showName}
          subtitle={`S${seasonNumber} E${episodeNumber}${episodeName ? ` · ${episodeName}` : ""}`}
          closeHref={closeHref}
          onClose={onClose}
          chrome={chrome}
          busy={buffering}
          // Not while transcoding: the preview reads the raw file, which this
          // browser has just been found unable to play -- and Safari, rather
          // than failing, downloads all of it (see directPlayRules.ts).
          previewSrc={transcoding ? null : videoUrl}
          trickplaySrc={videoUrl ? `${videoUrl}/trickplay` : null}
          extraBottomRight={
            <>
              <PlaybackOptionsMenu
                audioTracks={audioTracks}
                selectedAudio={selectedAudio}
                onAudio={selectAudio}
                subtitleTracks={subtitleTracks}
                selectedSubtitle={selectedSubtitle}
                onSubtitle={setSelectedSubtitle}
              />
              {next ? (
                <button
                  type="button"
                  onClick={() => onAdvance("manual")}
                  title={`Next: ${next.label}`}
                  aria-label={`Next episode: ${next.label}`}
                  className="shrink-0 touch-manipulation"
                >
                  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path d="M6 5v14l8.5-7L6 5zm10 0v14h2V5h-2z" />
                  </svg>
                </button>
              ) : null}
            </>
          }
        />
      )}
      {skip && (
        // Shown whether or not the controls are, like any streaming service's.
        <Button
          variant="secondary"
          size="md"
          onClick={() => chrome.seek(skip.to)}
          className="absolute bottom-24 right-[max(1.5rem,env(safe-area-inset-right,0px))] z-20 border-white/60 bg-black/60 px-5 py-2.5 text-base font-semibold text-white backdrop-blur-sm hover:bg-white hover:text-black"
        >
          {skip.label}
        </Button>
      )}
      {creditsCard && next && (
        <CreditsCard
          label={next.label}
          counting={chrome.isPlaying}
          onPlay={() => onAdvance("manual")}
          onDone={() => onAdvance("auto")}
          onWatchCredits={() => setWatchCredits(true)}
        />
      )}
      {showOverlay && (
        <>
          <Artwork src={backdropUrl} alt="" kind="backdrop" sizes="100vw" priority />
          <div className="hero-overlay absolute inset-0" />
          {(closeHref || onClose) &&
            (closeHref ? (
              <Link
                href={closeHref}
                prefetch
                aria-label="Close"
                className="absolute top-[calc(0.75rem+env(safe-area-inset-top,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 active:bg-black/80 touch-manipulation"
              >
                <CloseIcon />
              </Link>
            ) : (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute top-[calc(0.75rem+env(safe-area-inset-top,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 active:bg-black/80 touch-manipulation"
              >
                <CloseIcon />
              </button>
            ))}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            {!hasSource ? (
              // On its own dark panel: over a bright backdrop the bare text
              // was close to unreadable (reported 2026-10-19).
              <div
                role="status"
                className="z-10 flex max-w-sm flex-col items-center gap-2 rounded-xl bg-black/75 px-7 py-6 text-center shadow-xl backdrop-blur-sm"
              >
                {pending === "indexing" ? (
                  <span
                    className="h-10 w-10 rounded-full border-2 border-white/25 border-t-white animate-spin"
                    aria-hidden
                  />
                ) : (
                  <svg className="h-10 w-10 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                    />
                  </svg>
                )}
                <p className="text-lg font-semibold text-white">{pendingNotice(pending, `S${seasonNumber} E${episodeNumber}`).title}</p>
                <p className="text-sm leading-relaxed text-white/85">
                  {pendingNotice(pending, `S${seasonNumber} E${episodeNumber}`).body}
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

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/**
 * "Next episode" over the credits, counting down to rolling on. Mounted only
 * while shown, so each appearance starts the count afresh; it holds while
 * the video is paused.
 */
function CreditsCard({
  label,
  counting,
  onPlay,
  onDone,
  onWatchCredits,
}: {
  label: string;
  counting: boolean;
  onPlay: () => void;
  onDone: () => void;
  onWatchCredits: () => void;
}) {
  const [left, setLeft] = useState(CREDITS_COUNTDOWN_SECONDS);
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setLeft((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (left === 0) doneRef.current();
  }, [left]);
  return (
    <div className="absolute bottom-24 right-[max(1.5rem,env(safe-area-inset-right,0px))] z-20 flex max-w-xs flex-col gap-3 rounded-lg bg-black/75 p-4 text-white shadow-xl backdrop-blur-sm">
      <div>
        <p className="text-xs uppercase tracking-wide text-white/60">Next episode</p>
        <p className="truncate text-sm font-medium">{label}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="md" onClick={onPlay}>
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
          Play now ({left})
        </Button>
        <Button variant="secondary" size="md" onClick={onWatchCredits}>
          Watch credits
        </Button>
      </div>
    </div>
  );
}
