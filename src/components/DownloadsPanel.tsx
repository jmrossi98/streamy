"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
};

/** Stable and unique per row -- queue entries and completed titles can't collide. */
export function rowKey(d: DownloadRow): string {
  if (d.queueId != null) return `q${d.queueId}`;
  if (d.episodeId != null) return `ep-done-${d.episodeId}`;
  return `${d.mediaType}-done-${d.externalId}`;
}

const REFRESH_INTERVAL_MS = 5000;
const VISIBLE_ROWS = 5;
// ~52px per row (text line + progress bar + gaps) + list gaps, tuned so a
// sixth row is visibly cut off rather than the panel just guessing.
const MAX_HEIGHT_PX = VISIBLE_ROWS * 52 + (VISIBLE_ROWS - 1) * 12;

export function DownloadsPanel({ downloads }: { downloads: DownloadRow[] }) {
  const router = useRouter();
  const [managingKey, setManagingKey] = useState<string | null>(null);

  // Keep progress live without a manual reload, but only while something is
  // actually downloading -- a list of finished titles doesn't change on its own.
  const hasActive = downloads.some((d) => !d.completed);
  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasActive, router]);

  if (downloads.length === 0) {
    return <p className="text-white/50 text-sm">Nothing downloading right now.</p>;
  }

  async function handleManage(d: DownloadRow) {
    const key = rowKey(d);
    const action = d.completed ? "delete" : "cancel";
    // No confirm prompt: anything removed here can be downloaded again.
    setManagingKey(key);
    try {
      await fetch("/api/admin/downloads/manage", {
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
      router.refresh();
    } finally {
      setManagingKey(null);
    }
  }

  return (
    <ul
      className="space-y-3 overflow-y-auto pr-1"
      style={{ maxHeight: downloads.length > VISIBLE_ROWS ? `${MAX_HEIGHT_PX}px` : undefined }}
    >
      {downloads.map((d) => {
        const key = rowKey(d);
        const isManaging = managingKey === key;
        return (
          <li key={key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-white/90 truncate">{d.title}</span>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-white/50 tabular-nums">
                  {d.completed ? "Downloaded" : d.progress != null ? `${d.progress}%` : "metadata…"}
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
