"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

// Match the movie button: tight enough that a percentage visibly climbs
// while downloading, backed off when only a search is pending.
const POLL_INTERVAL_DOWNLOADING_MS = 5000;
const POLL_INTERVAL_QUEUED_MS = 12000;

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
    const values = Object.values(statuses);
    const anyDownloading = values.some((s) => s.status === "downloading");
    const anyActive = anyDownloading || values.some((s) => s.status === "requested");
    if (!anyActive) return;
    const interval = setInterval(
      refresh,
      anyDownloading ? POLL_INTERVAL_DOWNLOADING_MS : POLL_INTERVAL_QUEUED_MS
    );
    return () => clearInterval(interval);
  }, [statuses, refresh, enabled]);

  /** Paints one episode's state locally so a click registers before the server answers. */
  const setLocalState = useCallback((episodeNumber: number, next: EpisodeState | null) => {
    setStatuses((prev) => {
      const updated = { ...prev };
      if (next) updated[episodeNumber] = next;
      else delete updated[episodeNumber];
      return updated;
    });
  }, []);

  /**
   * Same, for a whole season at once. Requesting a season monitors every
   * episode before the searches start, so all of them are genuinely pending
   * from the moment the click lands -- they should look that way immediately
   * rather than one at a time as each search gets around to running.
   * Episodes already downloading or on disk keep their real state.
   */
  const setLocalStates = useCallback((episodeNumbers: number[], next: EpisodeState | null) => {
    setStatuses((prev) => {
      const updated = { ...prev };
      for (const n of episodeNumbers) {
        if (prev[n]?.status === "downloading" || prev[n]?.status === "available") continue;
        if (next) updated[n] = next;
        else delete updated[n];
      }
      return updated;
    });
  }, []);

  return { statuses, refresh, setLocalState, setLocalStates };
}

type Props = {
  showId: string;
  seasonNumber: number;
  /** Omit to request the whole season. */
  episodeNumber?: number;
  state?: EpisodeState;
  onRequested: () => void;
  /** Paints the new state immediately, before the server round trip lands. */
  onOptimistic?: (next: EpisodeState | null) => void;
  className?: string;
};

export function EpisodeDownloadButton({
  showId,
  seasonNumber,
  episodeNumber,
  state,
  onRequested,
  onOptimistic,
  className = "",
}: Props) {
  const { status: authStatus } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const scope = episodeNumber == null ? "season" : "episode";

  async function handleManage(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (loading) return;
    // No confirm prompt: anything removed here can be downloaded again from
    // this same control.
    setLoading(true);
    setError(false);
    const previous = state ?? null;
    onOptimistic?.(null);
    try {
      const res = await fetch("/api/requests/tv", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: showId, seasonNumber, episodeNumber }),
      });
      if (!res.ok) {
        onOptimistic?.(previous);
        setError(true);
        return;
      }
      onRequested();
    } catch {
      onOptimistic?.(previous);
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const manageButton = (
    <button
      type="button"
      onClick={handleManage}
      disabled={loading}
      className="text-xs font-medium text-white/40 hover:text-netflix-red disabled:opacity-50"
    >
      {loading ? "…" : state?.status === "available" ? "Delete" : "Cancel"}
    </button>
  );

  if (state) {
    if (state.status === "available") {
      return (
        <div className={`flex shrink-0 items-center gap-3 ${className}`}>
          <span className="text-xs font-medium text-white/40">Downloaded</span>
          {authStatus === "authenticated" && manageButton}
        </div>
      );
    }
    const downloading = state.status === "downloading";
    return (
      <div className={`flex w-28 shrink-0 flex-col gap-1 ${className}`}>
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs font-medium tabular-nums text-white/70">
            {/* Anything pending reads as "Starting…": once a season is
                requested every episode is queued for search, so an episode
                that hasn't reached the download client yet is still on its
                way, not idle. */}
            {downloading && state.progress != null ? `${state.progress}%` : "Starting…"}
          </span>
          {authStatus === "authenticated" && manageButton}
        </div>
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
    // Searching a season walks episode by episode and can take a while, so
    // reflect the click straight away rather than leaving the row idle.
    onOptimistic?.({ status: "requested", progress: null });
    try {
      const res = await fetch("/api/requests/tv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: showId, seasonNumber, episodeNumber }),
      });
      if (!res.ok) {
        onOptimistic?.(null);
        setError(true);
        return;
      }
      onRequested();
    } catch {
      onOptimistic?.(null);
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
