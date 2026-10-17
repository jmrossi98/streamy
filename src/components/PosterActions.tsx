"use client";

import { PosterWatchlistButton } from "@/components/PosterWatchlistButton";
import { PosterDownloadButton } from "@/components/PosterDownloadButton";

/**
 * The top-right controls on a poster tile: the admin's download button (when
 * there is something to download), then My List. Shown on hover from sm up,
 * always on touch screens.
 */
export function PosterActions({ movieId, showId }: { movieId?: string; showId?: string }) {
  return (
    <div className="pointer-events-none absolute top-2 right-2 z-[5] flex gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
      <PosterDownloadButton movieId={movieId} showId={showId} />
      <PosterWatchlistButton movieId={movieId} showId={showId} />
    </div>
  );
}
