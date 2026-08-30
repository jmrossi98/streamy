"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import type { ShowDetail, TVSeason, TVEpisode } from "@/lib/tmdb";
import { Credits } from "@/components/Credits";
import { WatchlistButton } from "@/components/WatchlistButton";
import { RequestButton } from "@/components/RequestButton";
import { InfoHero } from "@/components/InfoHero";
import { EpisodePlayer } from "@/components/EpisodePlayer";
import {
  EpisodeDownloadButton,
  useSeasonStatuses,
  type EpisodeState,
} from "@/components/EpisodeDownloadButton";

type ShowContentProps = {
  show: ShowDetail;
  initialSeason: TVSeason;
  initialSeasonNum: number;
  initialSeasonData: TVSeason | null;
  episodeProgress: { seasonNumber: number; episodeNumber: number; progressSeconds: number }[];
  initialInList?: boolean;
  resumePlayHref: string;
  resumePlayLabel: string;
  resumeSeason: number;
  resumeEpisode: number;
  resumeEpisodeName: string;
  resumeProgressSeconds: number;
  hasVideo?: boolean;
  requestConfigured?: boolean;
  initialRequestStatus?: string | null;
  initialProgress?: number | null;
  initialEpisodeStatuses?: Record<number, EpisodeState>;
  initialEpisodeStatusSeason?: number;
};

type OverlayEpisode = {
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string;
  progressSeconds: number;
  nextHref: string | null;
  nextLabel: string | null;
};

function getProgress(
  list: { seasonNumber: number; episodeNumber: number; progressSeconds: number }[],
  season: number,
  episode: number
): number {
  const row = list.find((p) => p.seasonNumber === season && p.episodeNumber === episode);
  return row?.progressSeconds ?? 0;
}

function progressPct(progressSeconds: number, runtimeMinutes: number | null): number {
  if (!runtimeMinutes || runtimeMinutes <= 0) return 0;
  return Math.min(100, Math.round((progressSeconds / (runtimeMinutes * 60)) * 100));
}

export function ShowContent({
  show,
  initialSeason,
  initialSeasonNum,
  initialSeasonData,
  episodeProgress,
  initialInList,
  resumePlayHref,
  resumePlayLabel,
  resumeSeason,
  resumeEpisode,
  resumeEpisodeName,
  resumeProgressSeconds,
  hasVideo = true,
  requestConfigured = false,
  initialRequestStatus = null,
  initialProgress = null,
  initialEpisodeStatuses,
  initialEpisodeStatusSeason,
}: ShowContentProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [seasonNum, setSeasonNum] = useState(initialSeasonNum);
  const [season, setSeason] = useState<TVSeason | null>(
    initialSeasonNum === 1 ? initialSeason : initialSeasonData
  );
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [overlayEpisode, setOverlayEpisode] = useState<OverlayEpisode | null>(null);
  const [overlaySubtitleTracks, setOverlaySubtitleTracks] = useState<{ index: number; label: string }[]>([]);

  // The watch pages resolve this server-side (they're server components); this
  // overlay only exists client-side, so it hits the list route instead. No
  // need to clear on close -- the overlay unmounts, and the next open's fetch
  // overwrites this before anything re-renders with it.
  useEffect(() => {
    if (!overlayEpisode) return;
    let cancelled = false;
    fetch(`/api/stream/episode/${show.id}/${overlayEpisode.seasonNumber}/${overlayEpisode.episodeNumber}/subtitles`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setOverlaySubtitleTracks(data.tracks ?? []);
      })
      .catch(() => {
        if (!cancelled) setOverlaySubtitleTracks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [show.id, overlayEpisode?.seasonNumber, overlayEpisode?.episodeNumber]);

  useEffect(() => {
    setSeasonNum(initialSeasonNum);
  }, [initialSeasonNum]);

  const closeOverlay = useCallback(() => {
    setOverlayEpisode((prev) => {
      if (prev) {
        router.replace(`${pathname}?season=${prev.seasonNumber}`, { scroll: false });
      }
      return null;
    });
  }, [pathname, router]);

  useEffect(() => {
    if (!overlayEpisode) return;
    const handlePopState = () => setOverlayEpisode(null);
    const episodePath = `/show/${show.id}/episode/${overlayEpisode.seasonNumber}/${overlayEpisode.episodeNumber}`;
    window.history.pushState({ overlay: true }, "", episodePath);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [overlayEpisode != null, overlayEpisode?.seasonNumber, overlayEpisode?.episodeNumber, show.id]);

  const openResumeOverlay = useCallback(() => {
    router.replace(`${pathname}?season=${resumeSeason}`, { scroll: false });
    setOverlayEpisode({
      seasonNumber: resumeSeason,
      episodeNumber: resumeEpisode,
      episodeName: resumeEpisodeName,
      progressSeconds: resumeProgressSeconds,
      nextHref: null,
      nextLabel: null,
    });
  }, [resumeSeason, resumeEpisode, resumeEpisodeName, resumeProgressSeconds, pathname, router]);

  const showRequestFlow = !hasVideo && requestConfigured;
  // Per-episode download controls are driven by Sonarr's live view of the
  // season, independent of whether the show as a whole is playable yet.
  const {
    statuses: episodeStatuses,
    refresh: refreshEpisodeStatuses,
    setLocalState: setEpisodeState,
    setLocalStates: setSeasonEpisodeStates,
  } = useSeasonStatuses(
    show.id,
    seasonNum,
    requestConfigured,
    initialEpisodeStatuses,
    initialEpisodeStatusSeason
  );

  // Roll the season's episodes up into one state so the season-level control
  // can show overall progress and offer cancel/delete for the whole season --
  // but only once every episode has at least been queued. Until then it stays
  // a plain "Download season" button: requestSeason already only searches
  // what's still missing (it re-checks monitored/hasFile per episode before
  // searching), so re-clicking is exactly "get the rest of the season" with
  // no risk of re-grabbing anything already done.
  const seasonEpisodeNumbers = season?.episodes.map((e) => e.episodeNumber) ?? [];
  const everyEpisodeQueued =
    seasonEpisodeNumbers.length > 0 &&
    seasonEpisodeNumbers.every((n) => episodeStatuses[n] != null);
  const seasonState = (() => {
    if (!everyEpisodeQueued) return undefined;
    const values = Object.values(episodeStatuses);
    const downloading = values.filter((v) => v.status === "downloading");
    if (downloading.length > 0) {
      const known = downloading.filter((v) => v.progress != null);
      const progress =
        known.length > 0
          ? Math.round(known.reduce((sum, v) => sum + (v.progress ?? 0), 0) / known.length)
          : null;
      return { status: "downloading" as const, progress };
    }
    if (values.some((v) => v.status === "requested")) {
      return { status: "requested" as const, progress: null };
    }
    return { status: "available" as const, progress: null };
  })();

  useEffect(() => {
    if (seasonNum === 1) {
      setSeason(initialSeason);
      setSeasonLoading(false);
      return;
    }
    if (initialSeasonNum === seasonNum && initialSeasonData) {
      setSeason(initialSeasonData);
      setSeasonLoading(false);
      return;
    }
    setSeasonLoading(true);
    fetch(`/api/tv/show/${show.id}/season/${seasonNum}`)
      .then((r) => r.json())
      .then((data) => {
        setSeason(data);
        setSeasonLoading(false);
      })
      .catch(() => {
        setSeason(null);
        setSeasonLoading(false);
      });
  }, [seasonNum, show.id, initialSeason, initialSeasonNum, initialSeasonData]);

  return (
    <div className="min-h-screen bg-black pb-16 pt-16 md:bg-netflix-black md:pb-12">
      {overlayEpisode && (
        <div className="fixed inset-0 z-[100] bg-netflix-black">
          <EpisodePlayer
            showId={show.id}
            showName={show.name}
            seasonNumber={overlayEpisode.seasonNumber}
            episodeNumber={overlayEpisode.episodeNumber}
            episodeName={overlayEpisode.episodeName}
            backdropUrl={show.backdrop}
            initialProgressSeconds={overlayEpisode.progressSeconds}
            runtimeMinutes={
              season?.episodes.find((e) => e.episodeNumber === overlayEpisode.episodeNumber)?.runtime ?? null
            }
            onClose={closeOverlay}
            autoPlay
            nextEpisodeHref={overlayEpisode.nextHref}
            nextEpisodeLabel={overlayEpisode.nextLabel ?? undefined}
            // Only hand the player a source once Sonarr says the file is on
            // disk; otherwise it shows its "not downloaded yet" state rather
            // than trying (and failing) to stream something that isn't there.
            videoUrl={
              episodeStatuses[overlayEpisode.episodeNumber]?.status === "available"
                ? `/api/stream/episode/${show.id}/${overlayEpisode.seasonNumber}/${overlayEpisode.episodeNumber}`
                : null
            }
            subtitleTracks={overlaySubtitleTracks}
          />
        </div>
      )}
      <InfoHero
        backdropUrl={show.backdrop}
        title={show.name}
        metaLine={[
          show.year,
          show.numberOfSeasons > 0 ? `${show.numberOfSeasons} Season${show.numberOfSeasons === 1 ? "" : "s"}` : null,
          show.genres.slice(0, 2).join(", ") || null,
        ]
          .filter(Boolean)
          .join(" · ")}
        badgeNodes={
          <>
            <span className="rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white/90">
              HD
            </span>
            <span className="rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/90">
              {show.rating.toFixed(1)} ★
            </span>
          </>
        }
        addToMyListMobile={
          <WatchlistButton showId={show.id} initialInList={initialInList} variant="circle" compact />
        }
        addToMyListDesktop={<WatchlistButton showId={show.id} initialInList={initialInList} />}
        playHref={resumePlayHref}
        playLabel={resumePlayLabel}
        playNode={
          showRequestFlow ? (
            <RequestButton showId={show.id} initialStatus={initialRequestStatus} initialProgress={initialProgress} />
          ) : (
            <button
              type="button"
              onClick={openResumeOverlay}
              className="inline-flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-sm font-bold uppercase tracking-[0.14em] text-netflix-black shadow-lg hover:bg-white/90 active:bg-white/85 touch-manipulation md:w-auto md:min-h-[44px] md:rounded md:px-6 md:py-3 md:text-base md:font-semibold md:normal-case md:tracking-normal md:shadow-none"
            >
              <svg className="h-6 w-6 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              {resumePlayLabel}
            </button>
          )
        }
      />

      <div id="details" className="mx-auto max-w-4xl scroll-mt-28 px-4 py-10 text-left sm:px-6 md:px-10">
        <div className="hidden md:block">
          <p className="mb-2 text-sm text-white/70">
            {show.year} · {show.rating}
          </p>
          <p className="text-lg text-white/80">{show.overview}</p>
        </div>

        <div className="md:hidden">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Synopsis</h2>
          <p className="text-base leading-relaxed text-white/85 sm:text-lg">{show.overview}</p>
        </div>

        {show.credits && (
          <div className="mt-8 md:mt-10">
            <Credits credits={show.credits} />
          </div>
        )}

        <div className="mt-8 flex items-center gap-4 mb-4 md:mt-10">
          <label className="text-white/80 text-sm">Season</label>
          <select
            value={seasonNum}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setSeasonNum(n);
              router.replace(`${pathname}?season=${n}`, { scroll: false });
            }}
            className="bg-netflix-black text-white border border-white/20 rounded px-3 py-2 focus:outline-none focus:border-netflix-red appearance-none cursor-pointer [&>option]:bg-netflix-black [&>option]:text-white"
          >
            {Array.from({ length: show.numberOfSeasons }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n} className="bg-netflix-black text-white">
                Season {n}
              </option>
            ))}
          </select>
          {requestConfigured && (
            <EpisodeDownloadButton
              showId={show.id}
              seasonNumber={seasonNum}
              state={seasonState}
              onRequested={refreshEpisodeStatuses}
              onOptimistic={(next) =>
                setSeasonEpisodeStates(
                  (season?.episodes ?? []).map((e) => e.episodeNumber),
                  next
                )
              }
              className="ml-auto"
            />
          )}
        </div>

        {seasonLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-10 h-10 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          </div>
        )}
        {!seasonLoading && season && (
          <ul className="space-y-2 mt-4">
            {season.episodes.map((ep: TVEpisode, index: number) => {
              const progressSeconds = getProgress(
                episodeProgress,
                ep.seasonNumber,
                ep.episodeNumber
              );
              const pct = progressPct(progressSeconds, ep.runtime);
              const nextEp = index + 1 < season.episodes.length ? season.episodes[index + 1] : null;
              // An episode is only playable once Sonarr reports a file on
              // disk. When downloads aren't wired up at all, fall back to the
              // show-level flag so this doesn't disable playback for
              // libraries that never used the request flow.
              const epState = episodeStatuses[ep.episodeNumber];
              const playable = requestConfigured ? epState?.status === "available" : hasVideo;
              const openEpisode = () => {
                if (!playable) return;
                router.replace(`${pathname}?season=${ep.seasonNumber}`, { scroll: false });
                setOverlayEpisode({
                  seasonNumber: ep.seasonNumber,
                  episodeNumber: ep.episodeNumber,
                  episodeName: ep.name,
                  progressSeconds,
                  nextHref: nextEp
                    ? `/show/${show.id}/episode/${nextEp.seasonNumber}/${nextEp.episodeNumber}`
                    : null,
                  nextLabel: nextEp
                    ? `S${nextEp.seasonNumber} E${nextEp.episodeNumber} · ${nextEp.name}`
                    : null,
                });
              };
              return (
                <li
                  key={ep.id}
                  className="flex gap-4 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <button
                    type="button"
                    onClick={openEpisode}
                    disabled={!playable}
                    aria-label={
                      playable
                        ? `Play ${ep.name}`
                        : `${ep.name} — not downloaded yet`
                    }
                    className={`flex gap-4 flex-1 min-w-0 text-left ${
                      playable ? "" : "cursor-default"
                    }`}
                  >
                    <div className="relative w-40 h-24 shrink-0 rounded overflow-hidden bg-white/10">
                      <Image
                        src={ep.still}
                        alt=""
                        fill
                        className={`object-cover ${playable ? "" : "opacity-40"}`}
                        sizes="160px"
                      />
                      {/* Only offer Play when there's actually something to
                          play -- a play button on an unfinished episode just
                          dead-ends at "not downloaded yet". */}
                      {playable ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
                          <span className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-netflix-black">
                            <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="rounded bg-black/70 px-2 py-1 text-[11px] font-medium text-white/80">
                            {epState?.status === "downloading"
                              ? epState.progress != null
                                ? `${epState.progress}%`
                                : "Starting…"
                              : epState
                                ? "Starting…"
                                : "Not downloaded"}
                          </span>
                        </div>
                      )}
                      {progressSeconds > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/30">
                          <div
                            className="h-full bg-netflix-red"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium">
                        {ep.episodeNumber}. {ep.name}
                      </p>
                      <p className="text-white/60 text-sm mt-0.5 line-clamp-2">{ep.overview}</p>
                      {progressSeconds > 0 && (
                        <p className="text-white/50 text-xs mt-1">
                          Resume from {Math.floor(progressSeconds / 60)}m
                          {ep.runtime ? ` · ${ep.runtime}m` : ""}
                        </p>
                      )}
                    </div>
                  </button>
                  {requestConfigured && (
                    <div className="flex shrink-0 items-center">
                      <EpisodeDownloadButton
                        showId={show.id}
                        seasonNumber={ep.seasonNumber}
                        episodeNumber={ep.episodeNumber}
                        state={episodeStatuses[ep.episodeNumber]}
                        onRequested={refreshEpisodeStatuses}
                        onOptimistic={(next) => setEpisodeState(ep.episodeNumber, next)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
