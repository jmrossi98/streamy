"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWatchlist } from "@/contexts/WatchlistContext";

export type WatchlistButtonProps = {
  movieId?: string;
  showId?: string;
  /** Circle-only icon button for hero (no text). */
  variant?: "default" | "circle";
  /** When `variant` is circle: fixed size (no hover expand) -- for info page icon row. */
  compact?: boolean;
};

/**
 * The My List button on a title's own page.
 *
 * Reads and writes the same WatchlistContext as every poster's + button.
 * It used to keep its own copy, seeded from the server render -- and the
 * client router can hand back a cached render of the page, so saving a title
 * from a person's page (a poster button) left this one still showing "Add"
 * until it was tapped again.
 */
export function WatchlistButton({ movieId, showId, variant = "default", compact = false }: WatchlistButtonProps) {
  const id = movieId ?? showId ?? "";
  const type = movieId ? "movie" : "show";
  const router = useRouter();
  const { data: session, status } = useSession();
  const { movieIds, showIds, toggleMovie, toggleShow } = useWatchlist();
  const inList = type === "movie" ? movieIds.has(id) : showIds.has(id);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!session?.user || loading || !id) return;
    setLoading(true);
    try {
      // The context flips first and reverts on failure.
      const ok = await (type === "movie" ? toggleMovie(id, !inList) : toggleShow(id, !inList));
      // My List rows are server-rendered, so they only follow on a re-render.
      if (ok) router.refresh();
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
    "inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[140px] sm:min-w-[160px] px-6 py-3 bg-white/20 text-white font-semibold rounded border border-white/40 hover:bg-white/30 disabled:opacity-50 transition-colors";

  if (status !== "authenticated") {
    return (
      <Link
        href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        className={variant === "circle" ? circleClass : "inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[140px] sm:min-w-[160px] px-6 py-3 bg-white/20 text-white font-semibold rounded border border-white/40 hover:bg-white/30 transition-colors"}
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
    if (compact) {
      return (
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          className={`${circleClass} h-12 w-12 shrink-0`}
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
        className={`group relative z-10 flex items-center justify-center overflow-hidden transition-[width] duration-200 ease-out ${circleClass} w-12 min-w-[3rem] hover:w-[7.5rem] hover:rounded-lg hover:pr-4 hover:justify-start`}
        aria-label={inList ? "In My List" : "Add to My List"}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center">
          {loading ? (
            <span className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
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
