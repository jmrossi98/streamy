"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatFileSize } from "@/lib/formatBytes";
import type { GameStatus } from "@/lib/games";

export type GameDownloadRow = {
  gameKey: string;
  title: string;
  platform: string;
  status: GameStatus;
  progress: number | null;
  error: string | null;
  sizeBytes: number | null;
  /** Set once gamarr has picked up a real job -- lets Cancel actually stop
   *  it. A still-queued wishlist entry with no job yet has none of these. */
  jobId: string | null;
  /** Set for a not-yet-downloading wishlist entry -- lets Remove drop it
   *  before gamarr ever starts searching for it. */
  wishlistId: number | null;
};

// Same reasoning as DownloadsPanel's own interval: nothing else on this page
// pushes a change here, so noticing a fresh queue/cancel/failure means
// polling, not waiting for someone to reload.
const REFRESH_INTERVAL_MS = 4000;

export function GameDownloadsPanel({ downloads }: { downloads: GameDownloadRow[] }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [managingKey, setManagingKey] = useState<string | null>(null);
  // Same optimistic-hide pattern as DownloadsPanel: gamarr takes a moment to
  // actually process a cancel/remove, and there's nothing to gain from
  // making the viewer stare at a row that's already been acted on.
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const visible = downloads.filter((d) => !removedKeys.has(d.gameKey));

  useEffect(() => {
    const present = new Set(downloads.map((d) => d.gameKey));
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

  useEffect(() => {
    const interval = setInterval(() => {
      if (!refreshing) router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router, refreshing]);

  async function handleManage(d: GameDownloadRow) {
    setManagingKey(d.gameKey);
    setRemovedKeys((prev) => new Set(prev).add(d.gameKey));
    try {
      const body = d.jobId
        ? { action: "cancel", jobId: d.jobId, title: d.title }
        : { action: "remove", id: d.wishlistId, title: d.title };
      const res = await fetch("/api/admin/games/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setRemovedKeys((prev) => {
          const next = new Set(prev);
          next.delete(d.gameKey);
          return next;
        });
      } else {
        router.refresh();
      }
    } catch {
      setRemovedKeys((prev) => {
        const next = new Set(prev);
        next.delete(d.gameKey);
        return next;
      });
    } finally {
      setManagingKey(null);
    }
  }

  if (visible.length === 0) {
    return <p className="text-sm text-white/50">No game downloads right now.</p>;
  }

  return (
    <ul className="space-y-3">
      {visible.map((d) => {
        const isManaging = managingKey === d.gameKey;
        return (
          <li key={d.gameKey} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-white/90">{d.title}</span>
                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">
                  {d.platform}
                </span>
                {formatFileSize(d.sizeBytes) && (
                  <span className="shrink-0 text-xs tabular-nums text-white/40">
                    {formatFileSize(d.sizeBytes)}
                  </span>
                )}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <span className="tabular-nums text-white/50">
                  {d.status === "failed"
                    ? "Failed"
                    : d.status === "queued"
                      ? "Queued"
                      : d.progress != null
                        ? `${d.progress}%`
                        : "Downloading…"}
                </span>
                <button
                  type="button"
                  onClick={() => handleManage(d)}
                  disabled={isManaging}
                  className="text-xs font-medium text-white/50 hover:text-netflix-red disabled:opacity-50"
                >
                  {isManaging ? "…" : d.jobId ? "Cancel" : "Remove"}
                </button>
              </div>
            </div>
            {d.error && <p className="truncate text-xs text-red-400">{d.error}</p>}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              {d.status === "failed" ? (
                <div className="h-full w-full rounded-full bg-red-500/60" />
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
