"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import { signOutIfStaleSession } from "@/lib/staleSession";
import { EMPTY_WATCHLIST, type WatchlistSnapshot } from "@/lib/watchlistSnapshot";

type WatchlistContextValue = {
  movieIds: Set<string>;
  showIds: Set<string>;
  loading: boolean;
  refresh: () => Promise<void>;
  toggleMovie: (id: string, add: boolean) => Promise<boolean>;
  toggleShow: (id: string, add: boolean) => Promise<boolean>;
};

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({
  initial = EMPTY_WATCHLIST,
  children,
}: {
  initial?: WatchlistSnapshot;
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const [movieIds, setMovieIds] = useState<Set<string>>(() => new Set(initial.movieIds));
  const [showIds, setShowIds] = useState<Set<string>>(() => new Set(initial.showIds));
  const [loading, setLoading] = useState(false);

  // The server already answered this question for the first render (see
  // app/layout.tsx). Spending a fetch to ask it again on mount is the round
  // trip this whole change exists to remove -- so the first pass through the
  // effect below consumes this flag and does nothing.
  //
  // It is deliberately only good once. When `status` later changes for real --
  // signing in, or a stale session being swapped out under us -- the effect
  // re-runs with the flag spent and fetches properly.
  const seeded = useRef(status === "authenticated");

  const refresh = useCallback(async () => {
    if (status !== "authenticated") {
      setMovieIds(new Set());
      setShowIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist");
      if (!res.ok) {
        setMovieIds(new Set());
        setShowIds(new Set());
        return;
      }
      const data = (await res.json()) as { movieIds?: string[]; showIds?: string[] };
      setMovieIds(new Set(data.movieIds ?? []));
      setShowIds(new Set(data.showIds ?? []));
    } catch {
      setMovieIds(new Set());
      setShowIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    void refresh();
  }, [refresh]);

  const toggleMovie = useCallback(async (id: string, add: boolean): Promise<boolean> => {
    if (add) {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieId: id }),
      });
      if (await signOutIfStaleSession(res)) return false;
      if (!res.ok) return false;
      setMovieIds((prev) => new Set(prev).add(id));
      return true;
    }
    const res = await fetch(`/api/watchlist?movieId=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (await signOutIfStaleSession(res)) return false;
    if (!res.ok) return false;
    setMovieIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    return true;
  }, []);

  const toggleShow = useCallback(async (id: string, add: boolean): Promise<boolean> => {
    if (add) {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId: id }),
      });
      if (await signOutIfStaleSession(res)) return false;
      if (!res.ok) return false;
      setShowIds((prev) => new Set(prev).add(id));
      return true;
    }
    const res = await fetch(`/api/watchlist?showId=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (await signOutIfStaleSession(res)) return false;
    if (!res.ok) return false;
    setShowIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    return true;
  }, []);

  const value = useMemo(
    () => ({
      movieIds,
      showIds,
      loading,
      refresh,
      toggleMovie,
      toggleShow,
    }),
    [movieIds, showIds, loading, refresh, toggleMovie, toggleShow]
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist() {
  const ctx = useContext(WatchlistContext);
  if (!ctx) {
    throw new Error("useWatchlist must be used within WatchlistProvider");
  }
  return ctx;
}
