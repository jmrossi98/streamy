"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import type { TVShow, TVSeason, TVEpisode } from "@/lib/tmdb";
import { WatchlistButton } from "@/components/WatchlistButton";
import { InfoHero } from "@/components/InfoHero";
import { EpisodePlayer } from "@/components/EpisodePlayer";

type ShowContentProps = {
  show: TVShow & { numberOfSeasons: number };
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
}: ShowContentProps) {
  const [seasonNum, setSeasonNum] = useState(initialSeasonNum);
  const [season, setSeason] = useState<TVSeason | null>(
    initialSeasonNum === 1 ? initialSeason : initialSeasonData
  );
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [overlayEpisode, setOverlayEpisode] = useState<OverlayEpisode | null>(null);

  const closeOverlay = useCallback(() => {
    setOverlayEpisode(null);
    if (typeof window !== "undefined" && (window.history.state as { overlay?: boolean } | null)?.overlay) {
      window.history.back();
    }
  }, []);

  useEffect(() => {
    if (!overlayEpisode) return;
    const handlePopState = () => setOverlayEpisode(null);
    const episodePath = `/show/${show.id}/episode/${overlayEpisode.seasonNumber}/${overlayEpisode.episodeNumber}`;
    window.history.pushState({ overlay: true }, "", episodePath);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [overlayEpisode != null, overlayEpisode?.seasonNumber, overlayEpisode?.episodeNumber, show.id]);

  const openResumeOverlay = useCallback(() => {
    setOverlayEpisode({
      seasonNumber: resumeSeason,
      episodeNumber: resumeEpisode,
      episodeName: resumeEpisodeName,
      progressSeconds: resumeProgressSeconds,
      nextHref: null,
      nextLabel: null,
    });
  }, [resumeSeason, resumeEpisode, resumeEpisodeName, resumeProgressSeconds]);

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
    <div className="min-h-screen bg-netflix-black pt-16 pb-12">
      {overlayEpisode && (
        <div className="fixed inset-0 z-[100] bg-netflix-black">
          <button
            type="button"
            onClick={closeOverlay}
            className="absolute top-4 right-4 z-[101] w-10 h-10 rounded-full bg-black/60 text-white hover:bg-black/80 flex items-center justify-center transition-colors"
            aria-label="Close and return to show"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <EpisodePlayer
            showId={show.id}
            showName={show.name}
            seasonNumber={overlayEpisode.seasonNumber}
            episodeNumber={overlayEpisode.episodeNumber}
            episodeName={overlayEpisode.episodeName}
            backdropUrl={show.backdrop}
            initialProgressSeconds={overlayEpisode.progressSeconds}
            autoPlay
            nextEpisodeHref={overlayEpisode.nextHref}
            nextEpisodeLabel={overlayEpisode.nextLabel ?? undefined}
          />
        </div>
      )}
      <InfoHero
        backdropUrl={show.backdrop}
        title={show.name}
        addToMyListNode={
          <WatchlistButton
            showId={show.id}
            initialInList={initialInList}
            variant="circle"
          />
        }
        playHref={resumePlayHref}
        playLabel={resumePlayLabel}
        playNode={
          <button
            type="button"
            onClick={openResumeOverlay}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white text-netflix-black font-semibold rounded hover:bg-white/90 transition-colors"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {resumePlayLabel}
          </button>
        }
      />

      <div className="max-w-4xl mx-auto px-6 py-10">
        <p className="text-white/70 text-sm mb-2">{show.year} · {show.rating}</p>
        <p className="text-white/80 text-lg">{show.overview}</p>

        <div className="flex items-center gap-4 mt-8 mb-4">
          <label className="text-white/80 text-sm">Season</label>
          <select
            value={seasonNum}
            onChange={(e) => setSeasonNum(parseInt(e.target.value, 10))}
            className="bg-netflix-black text-white border border-white/20 rounded px-3 py-2 focus:outline-none focus:border-netflix-red appearance-none cursor-pointer [&>option]:bg-netflix-black [&>option]:text-white"
          >
            {Array.from({ length: show.numberOfSeasons }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n} className="bg-netflix-black text-white">
                Season {n}
              </option>
            ))}
          </select>
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
              const openEpisode = () => {
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
                    className="flex gap-4 flex-1 min-w-0 text-left"
                  >
                    <div className="relative w-40 h-24 shrink-0 rounded overflow-hidden bg-white/10">
                      <Image
                        src={ep.still}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="160px"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
                        <span className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-netflix-black">
                          <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </span>
                      </div>
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
