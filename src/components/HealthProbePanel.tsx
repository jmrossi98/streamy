"use client";

import { useState } from "react";

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type HealthProbeRunSummary = {
  id: string;
  /** ISO string, not a Date: this crosses into a client component. */
  ranAt: string;
  success: boolean;
  summary: string;
  detail: string;
  durationMs: number | null;
  notified: boolean;
  remediated: string | null;
};

/**
 * History of the scheduled health probes (see lib/healthProbes.ts and
 * .github/workflows/health-probes.yml, which runs them every six hours).
 *
 * Deliberately shaped like PlaybackCheckPanel next to it: both are run
 * histories under a fixed summary, and two run-history lists that scroll and
 * expand differently would read as two unrelated features rather than two
 * checks.
 *
 * What it adds is the remediation line. These probes can act -- restarting
 * FlareSolverr when search stops yielding -- and an automatic action nobody
 * can see afterwards is worse than no action at all: the next person
 * debugging has a container that restarted for reasons not written anywhere.
 */
export function HealthProbePanel({ runs }: { runs: HealthProbeRunSummary[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <p className="text-sm text-white/50">
        No runs yet. Triggers every six hours via GitHub Actions, or run it manually from the
        Actions tab (&ldquo;Health Probes&rdquo;). Needs HEALTH_PROBE_SECRET set, or the
        endpoint fails closed.
      </p>
    );
  }

  const latest = runs[0];

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          latest.success
            ? "border-emerald-500/20 bg-emerald-500/5"
            : "border-red-500/30 bg-red-500/10"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <span
            className={`font-semibold ${latest.success ? "text-emerald-300" : "text-red-300"}`}
          >
            {latest.success ? "Passing" : "Failing"}
          </span>
          <span className="text-white/50">{timeAgo(latest.ranAt)}</span>
        </div>
        <p className="mt-1 text-white/70">{latest.summary}</p>
        {!latest.success && !latest.notified && (
          <p className="mt-1 text-xs text-amber-300/80">
            Alert not sent (notify not configured, or the send failed) -- this failure is only
            visible here.
          </p>
        )}
        {latest.remediated && (
          <p className="mt-1 text-xs text-white/50">Acted automatically -- open the run for what it did.</p>
        )}
      </div>

      <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
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
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      run.success ? "bg-emerald-400" : "bg-red-400"
                    }`}
                    aria-hidden
                  />
                  <span className="truncate text-white/80">{run.summary}</span>
                </span>
                <span className="shrink-0 text-white/40">{timeAgo(run.ranAt)}</span>
              </button>
              {isOpen && (
                <div className="space-y-2 border-t border-white/10 px-3 py-2">
                  {run.durationMs != null && (
                    <p className="text-xs text-white/50">{Math.round(run.durationMs / 1000)}s</p>
                  )}
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-white/70">
                    {run.detail}
                  </pre>
                  {run.remediated && (
                    <div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-white/30">
                        Acted automatically
                      </p>
                      <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-white/60">
                        {run.remediated}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
