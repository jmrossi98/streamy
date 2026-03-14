"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import type { TVShow, TVSeason, TVEpisode } from "@/lib/tmdb";
import { WatchlistButton } from "@/components/WatchlistButton";

type ShowContentProps = {
  show: TVShow & { numberOfSeasons: number };
  initialSeason: TVSeason;
  episodeProgress: { seasonNumber: number; episodeNumber: number; progressSeconds: number }[];
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
  episodeProgress,
}: ShowContentProps) {
  const [seasonNum, setSeasonNum] = useState(1);
  const [season, setSeason] = useState<TVSeason | null>(initialSeason);

  useEffect(() => {
    if (seasonNum === 1) {
      setSeason(initialSeason);
      return;
    }
    fetch(`/api/tv/show/${show.id}/season/${seasonNum}`)
      .then((r) => r.json())
      .then((data) => setSeason(data))
      .catch(() => setSeason(null));
  }, [seasonNum, show.id, initialSeason]);

  return (
    <div className="min-h-screen bg-netflix-black pt-24 pb-12 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row gap-6 mb-8">
          <div className="relative w-48 h-72 shrink-0 rounded overflow-hidden bg-white/10">
            <Image
              src={show.poster}
              alt={show.name}
              fill
              className="object-cover"
              sizes="192px"
            />
          </div>
          <div>
            <h1 className="font-display text-4xl font-bold text-white">{show.name}</h1>
            <p className="text-white/70 mt-2 text-sm">{show.year} · {show.rating}</p>
            <p className="text-white/80 mt-4">{show.overview}</p>
            <div className="mt-4">
              <WatchlistButton showId={show.id} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-4">
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

        {season && (
          <ul className="space-y-2">
            {season.episodes.map((ep: TVEpisode) => {
              const progressSeconds = getProgress(
                episodeProgress,
                ep.seasonNumber,
                ep.episodeNumber
              );
              const pct = progressPct(progressSeconds, ep.runtime);
              return (
                <li
                  key={ep.id}
                  className="flex gap-4 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <Link
                    href={`/show/${show.id}/episode/${ep.seasonNumber}/${ep.episodeNumber}`}
                    className="flex gap-4 flex-1 min-w-0"
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
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
