"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { DownloadProtocol } from "@/lib/radarr";

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
};

/** Stable and unique per row -- queue entries, completed titles, and
 *  searching requests can't collide even for the same show/movie. */
export function rowKey(d: DownloadRow): string {
  if (d.queueId != null) return `q${d.queueId}`;
  if (d.episodeId != null) return `ep-done-${d.episodeId}`;
  if (d.searching) return `${d.mediaType}-searching-${d.externalId}`;
  return `${d.mediaType}-done-${d.externalId}`;
}

// A new request happens on a different page/tab than this panel, so there's
// no way to learn about it except by polling -- 5s meant up to a 5s wait
// before a freshly-started movie showed up here at all. Confirmed the
// request itself is fast (~200ms for the Radarr round trip), so the delay
// was purely this interval; halving it halves the worst case.
const REFRESH_INTERVAL_MS = 2500;
const VISIBLE_ROWS = 5;
// ~52px per row (text line + progress bar + gaps) + list gaps, tuned so a
// sixth row is visibly cut off rather than the panel just guessing.
const MAX_HEIGHT_PX = VISIBLE_ROWS * 52 + (VISIBLE_ROWS - 1) * 12;

export function DownloadsPanel({ downloads }: { downloads: DownloadRow[] }) {
  const router = useRouter();
  const [managingKey, setManagingKey] = useState<string | null>(null);
  // Rows the viewer just cancelled/deleted, hidden immediately rather than
  // waiting for the server round trip + a fresh page render to catch up.
  // Radarr/Sonarr/qBittorrent all take a moment to actually process a
  // cancel, so waiting for the *real* state to reflect it before hiding the
  // row read as broken ("I need to refresh"). Rolled back on failure.
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const visibleDownloads = downloads.filter((d) => !removedKeys.has(rowKey(d)));

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
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  if (downloads.length === 0) {
    return <p className="text-white/50 text-sm">Nothing downloading right now.</p>;
  }

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

  if (visibleDownloads.length === 0) {
    return <p className="text-white/50 text-sm">Nothing downloading right now.</p>;
  }

  return (
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
  );
}
