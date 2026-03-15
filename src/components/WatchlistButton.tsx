"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

export type WatchlistButtonProps = {
  movieId?: string;
  showId?: string;
  /** When set, skips the client-side watchlist check on mount (faster info page load). */
  initialInList?: boolean;
  /** Circle-only icon button for hero (no text). */
  variant?: "default" | "circle";
};

export function WatchlistButton({ movieId, showId, initialInList, variant = "default" }: WatchlistButtonProps) {
  const id = movieId ?? showId ?? "";
  const type = movieId ? "movie" : "show";
  const { data: session, status } = useSession();
  const [inList, setInList] = useState(initialInList ?? false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialInList !== undefined || !session?.user || !id) return;
    const param = movieId ? `movieId=${encodeURIComponent(movieId)}` : `showId=${encodeURIComponent(showId!)}`;
    fetch(`/api/watchlist/check?${param}`)
      .then((r) => r.json())
      .then((data) => setInList(!!data.inList))
      .catch(() => setInList(false));
  }, [session?.user, id, movieId, showId, initialInList]);

  async function toggle() {
    if (!session?.user || loading || !id) return;
    setLoading(true);
    try {
      if (inList) {
        const param = movieId ? `movieId=${encodeURIComponent(movieId)}` : `showId=${encodeURIComponent(showId!)}`;
        await fetch(`/api/watchlist?${param}`, { method: "DELETE" });
        setInList(false);
      } else {
        await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(movieId ? { movieId } : { showId }),
        });
        setInList(true);
      }
    } finally {
      setLoading(false);
    }
  }

  const callbackUrl = type === "movie" ? `/watch/${id}` : `/show/${id}`;

  const icon = inList ? (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  ) : (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );

  const circleClass =
    "w-12 h-12 rounded-full bg-white/20 text-white border border-white/40 hover:bg-white/30 flex items-center justify-center disabled:opacity-50 transition-colors";
  const defaultClass =
    "inline-flex items-center gap-2 px-6 py-3 bg-white/20 text-white font-semibold rounded border border-white/40 hover:bg-white/30 disabled:opacity-50 transition-colors";

  if (status !== "authenticated") {
    return (
      <Link
        href={`/who-is-watching?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        className={variant === "circle" ? circleClass : "inline-flex items-center gap-2 px-6 py-3 bg-white/20 text-white font-semibold rounded border border-white/40 hover:bg-white/30 transition-colors"}
      >
        {variant === "circle" ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add to My List
          </>
        )}
      </Link>
    );
  }

  if (variant === "circle") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className={`group relative z-10 flex items-center justify-center overflow-hidden transition-[width] duration-200 ease-out ${circleClass} w-12 min-w-[3rem] hover:w-[7.5rem] hover:rounded-lg hover:pr-4 hover:justify-start`}
        aria-label={inList ? "In My List" : "Add to My List"}
      >
        <span className="flex shrink-0 items-center justify-center w-12 h-12">
          {loading ? (
            <span className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            icon
          )}
        </span>
        <span className="absolute left-12 top-0 flex h-full items-center whitespace-nowrap pl-1 text-sm font-semibold">
          My List
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className={defaultClass}
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
