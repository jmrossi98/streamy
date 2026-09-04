"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { DownloadProtocol } from "@/lib/radarr";
import { formatFileSize } from "@/lib/formatBytes";

export type DownloadRow = {
  /** Unique per row. A show can have several episodes downloading at once,
   *  so this is the queue entry, not the series. */
  queueId: number | null;
  /** The movie/series itself -- what a delete acts on. */
  externalId: number;
  /** Set for a completed TV episode, so delete removes just that episode. */
  episodeId?: number;
  title: string;
  progress: number | null;
  mediaType: "movie" | "show";
  completed: boolean;
  /** Requested but not yet picked up by Radarr/Sonarr's queue -- still
   *  searching for a release. Distinct from `completed`; both false means
   *  actively downloading with a real queue entry. */
  searching?: boolean;
  /** Which source this came from -- only known for an active queue entry
   *  (Radarr/Sonarr's own `protocol` field); absent for completed/searching
   *  rows, which never carry it. */
  protocol?: DownloadProtocol;
  /** Total release size in bytes. Known for an active queue entry (its own
   *  `size`) and a completed file (movieFile/episodefile's `size`); absent
   *  while still only searching, since there's no release chosen yet. */
  sizeBytes?: number | null;
};

/**
 * Stable across a download's *entire* lifecycle (searching -> queued ->
 * completed), not just unique within one snapshot -- deliberately not keyed
 * by queueId. The queue entry is deleted the moment Radarr/Sonarr finishes
 * importing a file, and a completed row has no queueId at all, so keying by
 * it made a download's row change identity mid-transfer: React saw a
 * disappearing `q12345` and an unrelated new `movie-done-67`, unmounted one
 * and mounted the other, and the row visually reset -- reported live as
 * "showed 14%, then reverted to starting, then later showed as downloaded"
 * for a title that, underneath, was progressing the entire time.
 *
 * A movie only ever has one active download at a time, so its externalId
 * alone is already a stable identity across every state. A show is
 * per-episode, so episodeId is preferred once it's known (threaded through
 * from Sonarr's own queue records now, not only completed episodes) --
 * queueId remains a fallback for the rare case it genuinely isn't (multiple
 * simultaneous episodes of the same show, before episodeId was available).
 */
export function rowKey(d: DownloadRow): string {
  if (d.mediaType === "movie") return `movie-${d.externalId}`;
  if (d.episodeId != null) return `ep-${d.episodeId}`;
  if (d.queueId != null) return `q${d.queueId}`;
  return `show-searching-${d.externalId}`;
}

// A new request happens on a different page/tab than this panel, so there's
// no way to learn about it except by polling -- 5s meant up to a 5s wait
// before a freshly-started movie showed up here at all. Confirmed the
// request itself is fast (~200ms for the Radarr round trip), so the delay
// was purely this interval; halving it halves the worst case.
const REFRESH_INTERVAL_MS = 2500;
// Was 5 -- confirmed live as too cramped once a season's worth of episodes
// (or several titles) were downloading at once, hiding most of them behind
// a scrollbar by default. 12 covers a full season's typical batch without
// scrolling; still capped so a genuinely huge backlog doesn't push the rest
// of the admin page off-screen.
const VISIBLE_ROWS = 12;
// ~52px per row (text line + progress bar + gaps) + list gaps, tuned so a
// row past the cap is visibly cut off rather than the panel just guessing.
const MAX_HEIGHT_PX = VISIBLE_ROWS * 52 + (VISIBLE_ROWS - 1) * 12;
// Radarr/Sonarr can briefly report a download as neither an active queue
// entry nor a completed file while they're mid-import -- the queue entry is
// gone and the library hasn't registered the new file yet. Bridging over
// that gap with the last real snapshot (rather than letting the row vanish
// for a poll or two) is what actually fixes the "reverted to starting"
// report on top of the rowKey fix above: even with a stable key, a real gap
// in the data would still make the row disappear and reappear. 20s covers
// several poll cycles; if a title is genuinely gone after that (deleted
// elsewhere), the bridge lapses and it drops out, same as before.
const BRIDGE_GRACE_MS = 20_000;

export function DownloadsPanel({ downloads }: { downloads: DownloadRow[] }) {
  const router = useRouter();
  // The panel already polls every REFRESH_INTERVAL_MS (below) -- this is for
  // the gap right after taking an action somewhere the poll doesn't cover
  // (e.g. cancelling directly in Radarr/Sonarr instead of from here), where
  // sitting on stale data for up to the full interval read as "I need to
  // reload the page" even though a refresh was always only moments away.
  const [refreshing, startRefresh] = useTransition();
  const [managingKey, setManagingKey] = useState<string | null>(null);
  // Rows the viewer just cancelled/deleted, hidden immediately rather than
  // waiting for the server round trip + a fresh page render to catch up.
  // Radarr/Sonarr/qBittorrent all take a moment to actually process a
  // cancel, so waiting for the *real* state to reflect it before hiding the
  // row read as broken ("I need to refresh"). Rolled back on failure.
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  // Last real (non-bridged) snapshot seen for each key, so a download that
  // drops out of both the active-queue and completed lists for a moment
  // keeps showing its last known progress instead of disappearing. Only
  // in-progress rows are worth bridging -- a completed one has nothing to
  // lose by just showing up whenever the next poll catches it.
  //
  // Bookkeeping lives in a ref (no need to re-render just because a snapshot
  // was recorded) and the derived, render-visible result in state -- both
  // updated from an effect, never read or written during render itself
  // (React Compiler's purity rules reject that outright, and rightly so: a
  // ref can change between a component's renders in ways the render itself
  // must not depend on).
  const lastSeenRef = useRef<Map<string, { row: DownloadRow; seenAt: number }>>(new Map());
  const [bridged, setBridged] = useState<DownloadRow[]>([]);
  useEffect(() => {
    const now = Date.now();
    for (const d of downloads) {
      if (!d.completed) lastSeenRef.current.set(rowKey(d), { row: d, seenAt: now });
    }
    const freshKeys = new Set(downloads.map(rowKey));
    const next: DownloadRow[] = [];
    for (const [key, entry] of lastSeenRef.current) {
      if (freshKeys.has(key) || removedKeys.has(key)) continue;
      if (now - entry.seenAt > BRIDGE_GRACE_MS) continue;
      next.push(entry.row);
    }
    setBridged(next);
    // Every poll re-runs this (downloads is a fresh array each time, even
    // when unchanged), which is what lets a bridged row's grace period
    // actually expire rather than only being re-evaluated when something
    // changes.
  }, [downloads, removedKeys]);

  const visibleDownloads = [...downloads, ...bridged].filter((d) => !removedKeys.has(rowKey(d)));

  // Once the server's own list no longer contains a key, there's nothing
  // left to hide -- prune it so the set doesn't grow across a long session.
  useEffect(() => {
    const present = new Set(downloads.map(rowKey));
    setRemovedKeys((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (present.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [downloads]);

  // Poll unconditionally rather than only while something is downloading --
  // a panel with nothing active still needs to notice a fresh request (from
  // this admin or anyone else) land and start searching, not sit static
  // until someone happens to reload the page.
  //
  // Skipped while a manual refresh (below) is already in flight -- confirmed
  // live that without this, the manual button's spinner never stopped.
  // router.refresh() calls aren't queued; a second one fired from this
  // interval while the manual click's own startTransition was still
  // tracking its call replaces it at the router level, and the original
  // transition then has nothing to resolve against -- isPending just never
  // flips back. Every REFRESH_INTERVAL_MS (2.5s) was frequent enough that
  // essentially any manual click landed in that window.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!refreshing) router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router, refreshing]);

  async function handleManage(d: DownloadRow) {
    const key = rowKey(d);
    const action = d.completed ? "delete" : "cancel";
    // No confirm prompt: anything removed here can be downloaded again.
    setManagingKey(key);
    // Optimistic: hide the row immediately. Radarr/Sonarr/qBittorrent take a
    // moment to actually process this, and there's no reason to make the
    // viewer stare at a stale row for that whole round trip.
    setRemovedKeys((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/admin/downloads/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalId: d.externalId,
          queueId: d.queueId,
          episodeId: d.episodeId,
          mediaType: d.mediaType,
          action,
          // For the audit log only -- the route already has everything it
          // needs to actually perform the action without this, but has no
          // way to turn a bare Radarr/Sonarr internal id back into a title
          // (unlike /api/requests/manage, which gets a tmdbId and can).
          title: d.title,
        }),
      });
      if (!res.ok) {
        // It didn't actually go through -- bring the row back.
        setRemovedKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } else {
        router.refresh();
      }
    } catch {
      setRemovedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } finally {
      setManagingKey(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-white/50 hover:text-white disabled:opacity-50"
        >
          <svg
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {visibleDownloads.length === 0 ? (
        <p className="text-white/50 text-sm">Nothing downloading right now.</p>
      ) : (
        <ul
          className="space-y-3 overflow-y-auto pr-1"
          style={{ maxHeight: visibleDownloads.length > VISIBLE_ROWS ? `${MAX_HEIGHT_PX}px` : undefined }}
        >
          {visibleDownloads.map((d) => {
            const key = rowKey(d);
            const isManaging = managingKey === key;
            return (
              <li key={key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-white/90 truncate">{d.title}</span>
                    {d.protocol && d.protocol !== "unknown" && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          d.protocol === "usenet"
                            ? "bg-sky-500/15 text-sky-300"
                            : "bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {d.protocol === "usenet" ? "Usenet" : "Torrent"}
                      </span>
                    )}
                    {formatFileSize(d.sizeBytes) && (
                      <span className="shrink-0 text-xs tabular-nums text-white/40">
                        {formatFileSize(d.sizeBytes)}
                      </span>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-white/50 tabular-nums">
                      {d.completed
                        ? "Downloaded"
                        : d.searching
                          ? "Searching…"
                          : d.progress != null
                            ? `${d.progress}%`
                            : "metadata…"}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleManage(d)}
                      disabled={isManaging}
                      className="text-xs font-medium text-white/50 hover:text-netflix-red disabled:opacity-50"
                    >
                      {isManaging ? "…" : d.completed ? "Delete" : "Cancel"}
                    </button>
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  {d.completed ? (
                    <div className="h-full w-full rounded-full bg-netflix-red" />
                  ) : d.progress != null ? (
                    <div
                      className="h-full rounded-full bg-netflix-red transition-[width] duration-500"
                      style={{ width: `${d.progress}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-white/20" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
