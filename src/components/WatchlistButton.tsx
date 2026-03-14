"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type Props = { movieId?: string; showId?: string };

export function WatchlistButton({ movieId, showId }: Props) {
  const id = movieId ?? showId ?? "";
  const type = movieId ? "movie" : "show";
  const { data: session, status } = useSession();
  const [inList, setInList] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session?.user || !id) return;
    const param = movieId ? `movieId=${encodeURIComponent(movieId)}` : `showId=${encodeURIComponent(showId!)}`;
    fetch(`/api/watchlist/check?${param}`)
      .then((r) => r.json())
      .then((data) => setInList(!!data.inList))
      .catch(() => setInList(false));
  }, [session?.user, id, movieId, showId]);

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

  if (status !== "authenticated") {
    return (
      <Link
        href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        className="inline-flex items-center gap-2 px-6 py-3 bg-white/20 text-white font-semibold rounded border border-white/40 hover:bg-white/30 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add to My List
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className="inline-flex items-center gap-2 px-6 py-3 bg-white/20 text-white font-semibold rounded border border-white/40 hover:bg-white/30 disabled:opacity-50 transition-colors"
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
