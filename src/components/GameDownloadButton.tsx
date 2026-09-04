"use client";

import { useState } from "react";
import type { GameStatus } from "@/lib/games";

export type GameDownloadButtonProps = {
  title: string;
  platform: string;
  platformSlug: string;
  status: GameStatus | "none";
  progress: number | null;
  error: string | null;
  wishlistId: number | null;
  jobId: string | null;
  sizeText?: string | null;
  /** Called after a successful queue/retry/remove so the parent can refresh
   *  the page's live state (same pattern DownloadsPanel/GamesPanel use). */
  onChanged: () => void;
};

const PRIMARY_CLASS =
  "inline-flex min-h-[44px] min-w-[160px] items-center justify-center gap-2 rounded bg-white px-6 py-3 font-semibold text-netflix-black transition-colors hover:bg-white/90 disabled:opacity-50";

/**
 * The one control this whole feature is "fully integrated with the download
 * setup" for -- queues via gamarr, same as the search flow this replaced,
 * but scoped to a single already-identified game rather than a search
 * result. Reuses /api/admin/games/queue unchanged (its default action
 * queues by title+platform, exactly what a not-yet-owned game needs).
 */
export function GameDownloadButton({
  title,
  platform,
  platformSlug,
  status,
  progress,
  error,
  wishlistId,
  jobId,
  sizeText,
  onChanged,
}: GameDownloadButtonProps) {
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/games/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (status === "library") {
    return (
      <span className="inline-flex min-h-[44px] items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-6 py-3 font-semibold text-emerald-300">
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
        Owned{sizeText ? ` · ${sizeText}` : ""}
      </span>
    );
  }

  if (status === "downloading") {
    return (
      <div className="flex min-w-[220px] flex-col gap-2 rounded border border-white/30 bg-white/10 px-6 py-3 text-white/90">
        <span className="text-sm font-semibold">
          {progress != null ? `Downloading… ${progress}%` : "Downloading…"}
        </span>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          {progress != null ? (
            <div
              className="h-full rounded-full bg-netflix-red transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-white/20" />
          )}
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={() => jobId && act({ action: "retry", jobId, title })}
          disabled={busy || !jobId}
          className={PRIMARY_CLASS}
        >
          {busy ? "Retrying…" : "Retry download"}
        </button>
        {error && <p className="max-w-sm text-sm text-red-400/80">{error}</p>}
      </div>
    );
  }

  if (status === "queued") {
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex min-h-[44px] items-center gap-2 rounded border border-white/30 bg-white/10 px-6 py-3 font-semibold text-white/80">
          Queued for download
        </span>
        <button
          type="button"
          onClick={() => wishlistId != null && act({ action: "remove", id: wishlistId, title })}
          disabled={busy || wishlistId == null}
          className="text-sm text-white/50 hover:text-white disabled:opacity-50"
        >
          {busy ? "…" : "Remove"}
        </button>
      </div>
    );
  }

  // status === "none": not yet requested at all.
  return (
    <button
      type="button"
      onClick={() => act({ title, platform, platformSlug })}
      disabled={busy}
      className={PRIMARY_CLASS}
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
      </svg>
      {busy ? "Queueing…" : "Download"}
    </button>
  );
}
