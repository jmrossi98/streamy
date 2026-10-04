"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

// Match the movie button: tight enough that a percentage visibly climbs
// while downloading, backed off when only a search is pending.
const POLL_INTERVAL_DOWNLOADING_MS = 5000;
const POLL_INTERVAL_QUEUED_MS = 8000;

// Right after a click, poll hard. Measured from the Lightsail box, a season
// status read costs Sonarr 30-85ms, so the old 12-second wait for the first
// real answer was not protecting anything -- it was just the cheapest
// interval to have written. The click already paints optimistically; this is
// about how fast the optimistic state gets replaced by a true one (found a
// release, or found nothing), which is the part that actually feels slow.
const BURST_INTERVAL_MS = 1000;
const BURST_WINDOW_MS = 20_000;

/** Exported for test: the cadence rules, without the effect around them. */
export function pollIntervalMs(bursting: boolean, anyDownloading: boolean): number {
  if (bursting) return BURST_INTERVAL_MS;
  return anyDownloading ? POLL_INTERVAL_DOWNLOADING_MS : POLL_INTERVAL_QUEUED_MS;
}

// "noReleaseFound" is distinct from "requested": Sonarr searched this
// episode and nothing cleared the quality/seeder bar, vs. still actively
// searching. Without the distinction both looked like the same indefinite
// spinner -- a title that would never come in without a config change read
// exactly like one about to succeed any second.
export type EpisodeStatus = "requested" | "noReleaseFound" | "downloading" | "available";
export type EpisodeState = {
  status: EpisodeStatus;
  progress: number | null;
  /** Releases that stalled or failed and were replaced in the last day. */
  tried?: number;
};

/** "2 releases stalled or failed and were replaced", for a tooltip. */
function triedText(tried: number): string {
  return `${tried} release${tried === 1 ? "" : "s"} stalled or failed and ${tried === 1 ? "was" : "were"} replaced`;
}

/**
 * Shared status poller for one season's episodes. Sonarr is the source of
 * truth (it already knows what's on disk and what's queued), so this reads
 * through to it rather than keeping per-episode rows in Streamy.
 */
export function useSeasonStatuses(
  showId: string,
  seasonNumber: number,
  enabled: boolean,
  /** Server-rendered statuses for `seedSeason`, so the first paint is already correct. */
  seed?: Record<number, EpisodeState>,
  seedSeason?: number,
  /** Every season on the page, fetched in the background so switching is instant. */
  prefetchSeasons: number[] = []
) {
  const [statuses, setStatuses] = useState<Record<number, EpisodeState>>(
    seedSeason === seasonNumber && seed ? seed : {}
  );

  // Statuses per season, kept for the life of the page.
  //
  // Switching seasons used to clear to {} and fetch, and {} renders exactly
  // like "nothing downloaded" -- so every episode flashed a Download button
  // until the response landed, then jumped to Starting or a percentage.
  // Unknown and not-downloaded are different facts; the cache means a season
  // already seen (or prefetched) paints its real state at once, and `loaded`
  // lets the rest say "still checking" instead of lying.
  const seasonCacheRef = useRef<Map<number, Record<number, EpisodeState>>>(
    new Map(seed && seedSeason != null ? [[seedSeason, seed]] : [])
  );
  const currentSeasonRef = useRef(seasonNumber);
  const [loadedSeason, setLoadedSeason] = useState<number | null>(
    seedSeason === seasonNumber && seed ? seasonNumber : null
  );

  // Cancelling an episode is several sequential Sonarr calls server-side
  // (look up the series, the queue, the file, then unmonitor -- see
  // manageSonarrEpisodes), easily a couple of seconds. The season's own poll
  // interval keeps running the whole time (other episodes are still active),
  // and a tick landing mid-cancel would read Sonarr's still-current state and
  // overwrite the optimistic clear with it -- confirmed live as the "still
  // says Starting… right after cancel" report. Recently-written episode
  // numbers are protected from being clobbered by a poll for a few seconds,
  // long enough for the mutation's own request to finish and settle things
  // properly either way.
  const RECENT_WRITE_GRACE_MS = 4000;
  const recentWritesRef = useRef<Map<number, number>>(new Map());

  // State rather than a ref: the polling effect has to re-run to pick up the
  // faster interval, and a ref mutation would not retrigger it.
  const [burstUntil, setBurstUntil] = useState(0);

  const fetchSeason = useCallback(
    async (season: number): Promise<Record<number, EpisodeState> | null> => {
      try {
        const res = await fetch(
          `/api/requests/tv?tmdbId=${encodeURIComponent(showId)}&season=${season}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.statuses ?? {};
      } catch {
        return null;
      }
    },
    [showId]
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const season = seasonNumber;
    try {
      // no-store, and it is not optional. A GET to an unchanging URL is
      // exactly what the browser's HTTP cache is for, so navigating away and
      // coming back re-served the response from before the download started
      // -- the button read "Start download" for something already in flight,
      // and stayed wrong until a hard refresh, because every later poll hit
      // the same cache entry.
      const res = await fetch(
        `/api/requests/tv?tmdbId=${encodeURIComponent(showId)}&season=${seasonNumber}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      const fresh: Record<number, EpisodeState> = data.statuses ?? {};
      seasonCacheRef.current.set(season, fresh);
      // A response for a season the viewer has already switched away from
      // goes into the cache only. Applying it would paint one season's
      // statuses onto another's episodes.
      if (currentSeasonRef.current !== season) return;
      setLoadedSeason(season);
      const now = Date.now();
      setStatuses((prev) => {
        const merged: Record<number, EpisodeState> = { ...fresh };
        for (const [epNum, writtenAt] of recentWritesRef.current) {
          if (now - writtenAt >= RECENT_WRITE_GRACE_MS) {
            recentWritesRef.current.delete(epNum);
            continue;
          }
          if (prev[epNum] !== undefined) merged[epNum] = prev[epNum];
          else delete merged[epNum];
        }
        return merged;
      });
    } catch {
      /* transient -- next tick retries */
    }
  }, [showId, seasonNumber, enabled]);

  // Switching seasons must clear the old season's rows, but the seeded season
  // already has correct data -- wiping it would reintroduce the blank flash
  // this seed exists to remove.
  const seededSeasonRef = useRef(seedSeason === seasonNumber ? seasonNumber : null);
  useEffect(() => {
    currentSeasonRef.current = seasonNumber;
    if (seededSeasonRef.current === seasonNumber) {
      seededSeasonRef.current = null; // only skip the very first pass
      refresh();
      return;
    }
    const cached = seasonCacheRef.current.get(seasonNumber);
    setStatuses(cached ?? {});
    setLoadedSeason(cached ? seasonNumber : null);
    refresh();
  }, [refresh, seasonNumber]);

  // Background prefetch of every other season, one at a time so a long
  // series does not fire dozens of Sonarr reads at once.
  const prefetchKey = prefetchSeasons.join(",");
  useEffect(() => {
    if (!enabled || !prefetchKey) return;
    let cancelled = false;
    (async () => {
      for (const season of prefetchKey.split(",").map(Number)) {
        if (cancelled) return;
        if (seasonCacheRef.current.has(season)) continue;
        const fresh = await fetchSeason(season);
        if (fresh && !seasonCacheRef.current.has(season)) {
          seasonCacheRef.current.set(season, fresh);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, prefetchKey, fetchSeason]);

  useEffect(() => {
    if (!enabled) return;
    const values = Object.values(statuses);
    const anyDownloading = values.some((s) => s.status === "downloading");
    const anyActive = anyDownloading || values.some((s) => s.status === "requested");
    if (!anyActive) return;
    const interval = setInterval(
      refresh,
      pollIntervalMs(Date.now() < burstUntil, anyDownloading)
    );
    return () => clearInterval(interval);
  }, [statuses, refresh, enabled, burstUntil]);

  // A tab that was in the background is showing whatever it last polled,
  // which after a few minutes away is simply wrong. Returning to it should
  // cost one request, not up to a full interval of staring at stale rows.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, enabled]);

  /** Paints one episode's state locally so a click registers before the server answers. */
  const setLocalState = useCallback((episodeNumber: number, next: EpisodeState | null) => {
    recentWritesRef.current.set(episodeNumber, Date.now());
    setBurstUntil(Date.now() + BURST_WINDOW_MS);
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
    setBurstUntil(Date.now() + BURST_WINDOW_MS);
    const now = Date.now();
    setStatuses((prev) => {
      const updated = { ...prev };
      for (const n of episodeNumbers) {
        if (prev[n]?.status === "downloading" || prev[n]?.status === "available") continue;
        recentWritesRef.current.set(n, now);
        if (next) updated[n] = next;
        else delete updated[n];
      }
      return updated;
    });
  }, []);

  return {
    statuses,
    loaded: loadedSeason === seasonNumber,
    refresh,
    setLocalState,
    setLocalStates,
  };
}

type Props = {
  showId: string;
  seasonNumber: number;
  /** Omit to request the whole season. */
  episodeNumber?: number;
  state?: EpisodeState;
  /** The season's statuses have not arrived yet, so "no state" means unknown,
   *  not "not downloaded". Renders a placeholder instead of a Download button
   *  that would be wrong a moment later. */
  statusLoading?: boolean;
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
  statusLoading = false,
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
    if (state.status === "noReleaseFound") {
      // Searched and nothing cleared the quality/seeder bar. Distinct from
      // the pending/spinner state below on purpose -- this is a dead end
      // until something changes (a fresh upload, a wider quality profile),
      // not "in progress." "Search again" re-runs the same search rather
      // than silently spinning, in case a better release has shown up since.
      return (
        <div className={`flex shrink-0 items-center gap-3 ${className}`}>
          <span
            className="text-xs font-medium text-white/40"
            title={
              state.tried
                ? `${triedText(state.tried)}, and no other release is available yet. It will keep looking.`
                : "No release met the quality/seeder bar"
            }
          >
            {state.tried ? `${state.tried} release${state.tried === 1 ? "" : "s"} failed` : "No release found"}
          </span>
          {authStatus === "authenticated" && (
            <button
              type="button"
              onClick={handleClick}
              disabled={loading}
              className="text-xs font-medium text-white/40 hover:text-white disabled:opacity-50"
            >
              {loading ? "…" : "Search again"}
            </button>
          )}
        </div>
      );
    }
    const downloading = state.status === "downloading";
    return (
      <div className={`flex w-28 shrink-0 flex-col gap-1 ${className}`}>
        <div className="flex items-center justify-end gap-2">
          <span
            className="text-xs font-medium tabular-nums text-white/70"
            title={state.tried ? `${triedText(state.tried)}.` : undefined}
          >
            {/* Anything pending reads as "Starting…": once a season is
                requested every episode is queued for search, so an episode
                that hasn't reached the download client yet is still on its
                way, not idle. After a replacement it says so instead, or a
                download that starts over looks like one that is broken. */}
            {downloading && state.progress != null
              ? `${state.progress}%`
              : state.tried
                ? "Trying another…"
                : "Starting…"}
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

  if (statusLoading) {
    // Same footprint as the button so the row does not reflow when the real
    // state arrives.
    return (
      <span
        aria-label="Checking download status"
        className={`inline-block h-[26px] w-16 shrink-0 animate-pulse rounded border border-white/10 bg-white/5 ${className}`}
      />
    );
  }

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
