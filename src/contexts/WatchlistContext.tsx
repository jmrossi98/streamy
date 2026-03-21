"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import { signOutIfStaleSession } from "@/lib/staleSession";

type WatchlistContextValue = {
  movieIds: Set<string>;
  showIds: Set<string>;
  loading: boolean;
  refresh: () => Promise<void>;
  toggleMovie: (id: string, add: boolean) => Promise<boolean>;
  toggleShow: (id: string, add: boolean) => Promise<boolean>;
};

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [movieIds, setMovieIds] = useState<Set<string>>(new Set());
  const [showIds, setShowIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

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
