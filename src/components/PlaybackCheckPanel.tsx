"use client";

import { useState } from "react";
import type { PlaybackCheckRunSummary } from "@/lib/playbackCheck";

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * History of the download -> playback end-to-end check (see
 * lib/playbackCheck.ts and .github/workflows/playback-check.yml, which runs
 * it daily). Read-only, like the rest of the ops surface -- there's nothing
 * to configure here, just what happened on each run. Embedded in the
 * Services section of the admin page (see admin/page.tsx) rather than its
 * own section -- it's itself a health check, just one that exercises the
 * whole download -> playback pipeline instead of probing one service.
 */
export function PlaybackCheckPanel({ runs }: { runs: PlaybackCheckRunSummary[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <p className="text-white/50 text-sm">
        No runs yet. Triggers daily via GitHub Actions, or run it manually from the Actions tab
        (&ldquo;Download &amp; Playback Check&rdquo;).
      </p>
    );
  }

  const latest = runs[0];

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          latest.success ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/30 bg-red-500/10"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className={`font-semibold ${latest.success ? "text-emerald-300" : "text-red-300"}`}>
            {latest.success ? "Passing" : "Failing"}
          </span>
          <span className="text-white/50">{timeAgo(latest.ranAt)}</span>
        </div>
        <p className="mt-1 text-white/70">{latest.summary}</p>
        {!latest.success && !latest.notified && (
          <p className="mt-1 text-xs text-amber-300/80">
            Alert not sent (notify not configured, or the send failed) -- this failure is only visible here.
          </p>
        )}
      </div>

      <ul className="space-y-2">
        {runs.map((run) => {
          const isOpen = expanded === run.id;
          return (
            <li key={run.id} className="rounded border border-white/10 bg-black/20">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : run.id)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${run.success ? "bg-emerald-400" : "bg-red-400"}`}
                    aria-hidden
                  />
                  <span className="truncate text-white/80">{run.summary}</span>
                </span>
                <span className="shrink-0 text-white/40">{timeAgo(run.ranAt)}</span>
              </button>
              {isOpen && (
                <div className="border-t border-white/10 px-3 py-2">
                  {run.testTitle && (
                    <p className="mb-1 text-xs text-white/50">
                      {run.testTitle}
                      {run.durationMs != null ? ` · ${Math.round(run.durationMs / 1000)}s` : ""}
                    </p>
                  )}
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-white/70">
                    {run.detail}
                  </pre>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
