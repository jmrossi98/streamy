"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useWatchlist } from "@/contexts/WatchlistContext";
import { PosterIconButton } from "@/components/ui";

type Props = {
  movieId?: string;
  showId?: string;
  className?: string;
};

/**
 * Top-right control on row posters: + add / − remove from My List.
 * On `/watchlist`, always − (remove). Elsewhere, + if not saved, − if already in list.
 */
export function PosterWatchlistButton({ movieId, showId, className = "" }: Props) {
  const pathname = usePathname();
  const { status } = useSession();
  const { movieIds, showIds, toggleMovie, toggleShow } = useWatchlist();
  const [busy, setBusy] = useState(false);

  const id = movieId ?? showId ?? "";
  const isMovie = Boolean(movieId);
  const inList = isMovie ? movieIds.has(id) : showIds.has(id);
  const onWatchlistPage = pathname === "/watchlist";

  if (status !== "authenticated" || !id) return null;

  const showMinus = onWatchlistPage || inList;

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      // On My List the tile leaves as soon as the shared state drops it (see
      // WatchlistContent); no server round trip for the whole page.
      if (onWatchlistPage || inList) {
        await (isMovie ? toggleMovie(id, false) : toggleShow(id, false));
      } else {
        await (isMovie ? toggleMovie(id, true) : toggleShow(id, true));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PosterIconButton
      onClick={handleClick}
      disabled={busy}
      aria-label={showMinus ? "Remove from My List" : "Add to My List"}
      className={`text-xl font-light leading-none ${className}`}
    >
      {busy ? (
        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      ) : showMinus ? (
        <span className="pb-0.5" aria-hidden>
          −
        </span>
      ) : (
        <span className="pb-0.5" aria-hidden>
          +
        </span>
      )}
    </PosterIconButton>
  );
}
