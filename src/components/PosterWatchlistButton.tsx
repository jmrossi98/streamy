"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useWatchlist } from "@/contexts/WatchlistContext";

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
  const router = useRouter();
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
      if (onWatchlistPage) {
        const ok = isMovie ? await toggleMovie(id, false) : await toggleShow(id, false);
        if (ok) router.refresh();
      } else if (inList) {
        await (isMovie ? toggleMovie(id, false) : toggleShow(id, false));
      } else {
        await (isMovie ? toggleMovie(id, true) : toggleShow(id, true));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-label={showMinus ? "Remove from My List" : "Add to My List"}
      className={`pointer-events-auto min-w-[36px] min-h-[36px] w-9 h-9 rounded-full bg-black/75 border border-white/35 text-white text-xl font-light leading-none flex items-center justify-center shadow-lg hover:bg-black/90 hover:scale-105 active:scale-100 transition-all disabled:opacity-60 ${className}`}
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
    </button>
  );
}
