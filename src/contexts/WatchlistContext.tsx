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
import { watchlistAddRequest, watchlistRemoveRequest } from "@/lib/watchlistKinds";
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

  /**
   * Applied to local state first, then sent.
   *
   * These back every poster on every page -- by far the most-used My List
   * control in the app -- and they were the last ones still waiting for the
   * round trip before showing anything. WatchlistToggle and WatchlistButton
   * both flip first; this did not, so the busiest button stayed the slowest to
   * acknowledge a tap. A failed write puts the old value back.
   */
  const toggleMovie = useCallback(async (id: string, add: boolean): Promise<boolean> => {
    setMovieIds((prev) => {
      const next = new Set(prev);
      if (add) next.add(id);
      else next.delete(id);
      return next;
    });
    const revert = () =>
      setMovieIds((prev) => {
        const next = new Set(prev);
        if (add) next.delete(id);
        else next.add(id);
        return next;
      });

    try {
      const [url, init] = add
        ? watchlistAddRequest("movie", id)
        : watchlistRemoveRequest("movie", id);
      const res = await fetch(url, init);
      if (await signOutIfStaleSession(res)) return false;
      if (!res.ok) {
        revert();
        return false;
      }
      return true;
    } catch {
      revert();
      return false;
    }
  }, []);

  /** Same shape as toggleMovie above, and for the same reason. */
  const toggleShow = useCallback(async (id: string, add: boolean): Promise<boolean> => {
    setShowIds((prev) => {
      const next = new Set(prev);
      if (add) next.add(id);
      else next.delete(id);
      return next;
    });
    const revert = () =>
      setShowIds((prev) => {
        const next = new Set(prev);
        if (add) next.delete(id);
        else next.add(id);
        return next;
      });

    try {
      const [url, init] = add
        ? watchlistAddRequest("show", id)
        : watchlistRemoveRequest("show", id);
      const res = await fetch(url, init);
      if (await signOutIfStaleSession(res)) return false;
      if (!res.ok) {
        revert();
        return false;
      }
      return true;
    } catch {
      revert();
      return false;
    }
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
