"use client";

import Image from "next/image";
import Link from "next/link";
import type { GameListItem } from "@/lib/games";
import { GameWatchlistButton } from "./GameWatchlistButton";

/**
 * Portrait poster tile for a game -- same card shape/hover behavior as
 * MovieRow's cards, but portrait (Steam cover-art aspect) instead of the
 * landscape thumbnail movies/shows use.
 */
export function GameCard({ item, inWatchlist }: { item: GameListItem; inWatchlist: boolean }) {
  const href = `/games/${encodeURIComponent(item.gameKey)}`;
  const statusLabel =
    item.status === "downloading"
      ? item.progress != null
        ? `${item.progress}%`
        : "Downloading…"
      : item.status === "queued"
        ? "Queued"
        : item.status === "failed"
          ? "Failed"
          : null;

  return (
    <div className="group relative block w-[140px] shrink-0 touch-manipulation overflow-hidden rounded bg-netflix-dark sm:w-[160px] md:w-[180px]">
      <div className="relative aspect-[2/3] w-full">
        <Link href={href} prefetch className="absolute inset-0 z-0 block">
          {item.posterUrl ? (
            <Image
              src={item.posterUrl}
              alt={item.title}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 140px, (max-width: 768px) 160px, 180px"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-white/5 px-3 text-center">
              <svg className="h-8 w-8 text-white/25" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M6 12h4m-2-2v4m7-3h.01M17 13h.01M9 18h6a3 3 0 003-3v-2a5 5 0 00-5-5H8a5 5 0 00-5 5v2a3 3 0 003 3z"
                />
              </svg>
              <span className="text-[11px] leading-tight text-white/40">{item.title}</span>
            </div>
          )}
        </Link>
        <div className="pointer-events-none absolute inset-0 z-[1] bg-black/40 opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="absolute right-2 top-2 z-[5] pointer-events-auto opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <GameWatchlistButton
            gameKey={item.gameKey}
            title={item.title}
            platform={item.platform}
            initialInList={inWatchlist}
            variant="circle"
          />
        </div>
        {statusLabel && (
          <span className="absolute bottom-2 left-2 z-[2] rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
            {statusLabel}
          </span>
        )}
        {item.status === "downloading" && item.progress != null && (
          <div className="absolute bottom-0 left-0 right-0 z-[2] h-1 bg-white/30">
            <div className="h-full bg-netflix-red transition-all" style={{ width: `${item.progress}%` }} />
          </div>
        )}
      </div>
      <Link href={href} prefetch className="block p-2">
        <p className="truncate text-sm font-medium text-white">{item.title}</p>
        <p className="text-xs text-white/60">{item.platform}</p>
      </Link>
    </div>
  );
}
