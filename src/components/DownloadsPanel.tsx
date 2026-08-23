"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type DownloadRow = { id: number; title: string; progress: number | null; mediaType: "movie" | "show" };

export function DownloadsPanel({ downloads }: { downloads: DownloadRow[] }) {
  const router = useRouter();
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);

  if (downloads.length === 0) {
    return <p className="text-white/50 text-sm">Nothing downloading right now.</p>;
  }

  async function handleCancel(d: DownloadRow) {
    const key = d.mediaType + d.id;
    if (!window.confirm(`Cancel "${d.title}"? This deletes any partial download.`)) return;
    setCancellingKey(key);
    try {
      await fetch("/api/admin/downloads/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, mediaType: d.mediaType }),
      });
      router.refresh();
    } finally {
      setCancellingKey(null);
    }
  }

  return (
    <ul className="space-y-3">
      {downloads.map((d) => {
        const key = d.mediaType + d.id;
        return (
          <li key={key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-white/90 truncate">{d.title}</span>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-white/50 tabular-nums">
                  {d.progress != null ? `${d.progress}%` : "metadata…"}
                </span>
                <button
                  type="button"
                  onClick={() => handleCancel(d)}
                  disabled={cancellingKey === key}
                  className="text-xs font-medium text-white/50 hover:text-netflix-red disabled:opacity-50"
                >
                  {cancellingKey === key ? "Cancelling…" : "Cancel"}
                </button>
              </div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              {d.progress != null ? (
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
