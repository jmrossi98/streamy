"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export type GameDownloadRow = {
  /** jobId, wishlist id, or a fallback -- unique per row, not gamesList's
   *  own gameKey (this deliberately shows a *completed* job too, which
   *  gamesList already folded into "library" status). */
  key: string;
  title: string;
  platform: string;
  status: "downloading" | "completed" | "failed" | "queued" | "owned";
  progress: number | null;
  error: string | null;
  /** gamarr reports size as a formatted string ("650 MB"), not bytes, for
   *  a job -- pass it straight through rather than re-deriving. */
  sizeText: string | null;
  /** Set once gamarr has picked up a real job -- lets Cancel/Clear actually
   *  act on it. A still-queued wishlist entry with no job yet has none. */
  jobId: string | null;
  /** Set for a not-yet-downloading wishlist entry -- lets Remove drop it
   *  before gamarr ever starts searching for it. */
  wishlistId: number | null;
  /** Set for an owned library game -- what a delete acts on. */
  system: string | null;
  romStem: string | null;
};

// Same reasoning as DownloadsPanel's own interval: nothing else on this page
// pushes a change here, so noticing a fresh queue/cancel/failure means
// polling, not waiting for someone to reload.
const REFRESH_INTERVAL_MS = 4000;
// Same cap and row arithmetic as DownloadsPanel, for the same reason -- but
// it matters more here: this list now includes every owned game (~150), so
// without a cap it pushed the whole rest of the admin page off-screen.
const VISIBLE_ROWS = 12;
const MAX_HEIGHT_PX = VISIBLE_ROWS * 52 + (VISIBLE_ROWS - 1) * 12;

export function GameDownloadsPanel({ downloads }: { downloads: GameDownloadRow[] }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [managingKey, setManagingKey] = useState<string | null>(null);
  // Same optimistic-hide pattern as DownloadsPanel: gamarr takes a moment to
  // actually process a cancel/remove, and there's nothing to gain from
  // making the viewer stare at a row that's already been acted on.
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const visible = downloads.filter((d) => !removedKeys.has(d.key));

  useEffect(() => {
    const present = new Set(downloads.map((d) => d.key));
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
    // Deleting an owned game removes the ROM from disk and is not
    // recoverable without re-downloading, unlike cancelling a job or
    // dropping a wishlist entry -- so it's the one action here that asks
    // first. Confirmed inline rather than with a custom modal to keep the
    // affordance impossible to miss or mis-click past.
    const isDelete = d.status === "owned";
    if (isDelete && !confirm(`Delete "${d.title}" from disk?\n\nThis frees the space and removes it from Streamy and the Steam Deck. You'd have to download it again to get it back.`)) {
      return;
    }

    setManagingKey(d.key);
    setRemovedKeys((prev) => new Set(prev).add(d.key));
    try {
      const url = isDelete ? "/api/admin/games/delete" : "/api/admin/games/queue";
      const body = isDelete
        ? { system: d.system, romStem: d.romStem, title: d.title }
        : d.jobId
          ? { action: "cancel", jobId: d.jobId, title: d.title }
          : { action: "remove", id: d.wishlistId, title: d.title };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setRemovedKeys((prev) => {
          const next = new Set(prev);
          next.delete(d.key);
          return next;
        });
      } else {
        router.refresh();
      }
    } catch {
      setRemovedKeys((prev) => {
        const next = new Set(prev);
        next.delete(d.key);
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
    <ul
      className="space-y-3 overflow-y-auto pr-1"
      style={{ maxHeight: visible.length > VISIBLE_ROWS ? `${MAX_HEIGHT_PX}px` : undefined }}
    >
      {visible.map((d) => {
        const isManaging = managingKey === d.key;
        return (
          <li key={d.key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-white/90">{d.title}</span>
                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">
                  {d.platform}
                </span>
                {d.sizeText && (
                  <span className="shrink-0 text-xs tabular-nums text-white/40">{d.sizeText}</span>
                )}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <span className="tabular-nums text-white/50">
                  {d.status === "owned"
                    ? "In library"
                    : d.status === "completed"
                      ? "Downloaded"
                      : d.status === "failed"
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
                  {isManaging
                    ? "…"
                    : d.status === "owned"
                      ? "Delete"
                      : !d.jobId
                        ? "Remove"
                        : d.status === "completed"
                          ? "Clear"
                          : "Cancel"}
                </button>
              </div>
            </div>
            {d.error && <p className="truncate text-xs text-red-400">{d.error}</p>}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              {d.status === "owned" ? (
                <div className="h-full w-full rounded-full bg-white/15" />
              ) : d.status === "failed" ? (
                <div className="h-full w-full rounded-full bg-red-500/60" />
              ) : d.status === "completed" ? (
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
