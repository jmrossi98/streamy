"use client";

import { useState } from "react";

export type GameWatchlistButtonProps = {
  gameKey: string;
  title: string;
  platform: string;
  initialInList: boolean;
  /** Circle-only icon button for poster overlays (no text), matching
   *  WatchlistButton's movie/show variant. */
  variant?: "default" | "circle";
};

/**
 * My List toggle for a game -- same shape as WatchlistButton (movies/shows),
 * simplified since every page this renders on is already admin-gated: no
 * "sign in to add" fallback state is reachable here.
 */
export function GameWatchlistButton({
  gameKey,
  title,
  platform,
  initialInList,
  variant = "default",
}: GameWatchlistButtonProps) {
  const [inList, setInList] = useState(initialInList);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (loading) return;
    setLoading(true);
    try {
      if (inList) {
        const res = await fetch(`/api/games/watchlist?gameKey=${encodeURIComponent(gameKey)}`, {
          method: "DELETE",
        });
        if (res.ok) setInList(false);
      } else {
        const res = await fetch("/api/games/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameKey, title, platform }),
        });
        if (res.ok) setInList(true);
      }
    } finally {
      setLoading(false);
    }
  }

  const icon = inList ? (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  ) : (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );

  if (variant === "circle") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white transition-colors hover:bg-white/30 disabled:opacity-50"
        aria-label={inList ? "In My List" : "Add to My List"}
      >
        {loading ? (
          <span className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        ) : (
          icon
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className="inline-flex min-h-[44px] min-w-[140px] items-center justify-center gap-2 rounded border border-white/40 bg-white/20 px-6 py-3 font-semibold text-white transition-colors hover:bg-white/30 disabled:opacity-50 sm:min-w-[160px]"
    >
      {inList ? (
        <>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
          In My List
        </>
      ) : (
        <>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {loading ? "…" : "Add to My List"}
        </>
      )}
    </button>
  );
}
