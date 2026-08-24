"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

const POLL_INTERVAL_MS = 8000;

export type EpisodeStatus = "requested" | "downloading" | "available";
export type EpisodeState = { status: EpisodeStatus; progress: number | null };

/**
 * Shared status poller for one season's episodes. Sonarr is the source of
 * truth (it already knows what's on disk and what's queued), so this reads
 * through to it rather than keeping per-episode rows in Streamy.
 */
export function useSeasonStatuses(showId: string, seasonNumber: number, enabled: boolean) {
  const [statuses, setStatuses] = useState<Record<number, EpisodeState>>({});

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(
        `/api/requests/tv?tmdbId=${encodeURIComponent(showId)}&season=${seasonNumber}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setStatuses(data.statuses ?? {});
    } catch {
      /* transient -- next tick retries */
    }
  }, [showId, seasonNumber, enabled]);

  useEffect(() => {
    setStatuses({});
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const anyActive = Object.values(statuses).some(
      (s) => s.status === "requested" || s.status === "downloading"
    );
    if (!anyActive) return;
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [statuses, refresh, enabled]);

  return { statuses, refresh };
}

type Props = {
  showId: string;
  seasonNumber: number;
  /** Omit to request the whole season. */
  episodeNumber?: number;
  state?: EpisodeState;
  onRequested: () => void;
  className?: string;
};

export function EpisodeDownloadButton({
  showId,
  seasonNumber,
  episodeNumber,
  state,
  onRequested,
  className = "",
}: Props) {
  const { status: authStatus } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  if (state) {
    if (state.status === "available") {
      return (
        <span className={`shrink-0 text-xs font-medium text-white/40 ${className}`}>
          Downloaded
        </span>
      );
    }
    const downloading = state.status === "downloading";
    return (
      <div className={`flex w-24 shrink-0 flex-col gap-1 ${className}`}>
        <span className="text-right text-xs font-medium tabular-nums text-white/70">
          {downloading
            ? state.progress != null
              ? `${state.progress}%`
              : "Starting…"
            : "Searching…"}
        </span>
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          {downloading && state.progress != null ? (
            <div
              className="h-full rounded-full bg-netflix-red transition-[width] duration-500"
              style={{ width: `${state.progress}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-white/25" />
          )}
        </div>
      </div>
    );
  }

  if (authStatus !== "authenticated") return null;

  const label = episodeNumber == null ? "Download season" : "Download";

  async function handleClick(e: React.MouseEvent) {
    // Episode rows are themselves buttons that open the player.
    e.stopPropagation();
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/requests/tv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: showId, seasonNumber, episodeNumber }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      onRequested();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`shrink-0 rounded border border-white/25 px-2.5 py-1 text-xs font-medium text-white/80 hover:border-white/50 hover:text-white disabled:opacity-50 ${className}`}
    >
      {loading ? "…" : error ? "Retry" : label}
    </button>
  );
}
