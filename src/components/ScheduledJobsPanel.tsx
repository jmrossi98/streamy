"use client";

import { useState } from "react";
import type { ProbeLine } from "@/lib/scheduledJobs";

export type ScheduledJobRow = {
  name: string;
  user: string;
  schedule: string;
  command: string;
  lastRun: string | null;
  lastOutput: string | null;
  health: "ok" | "overdue" | "unobservable" | "unknown";
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const DOT: Record<string, string> = {
  pass: "bg-emerald-400",
  ok: "bg-emerald-400",
  fail: "bg-red-400",
  overdue: "bg-red-400",
  skip: "bg-white/25",
  unobservable: "bg-white/25",
  unknown: "bg-amber-400/70",
};

const HEALTH_LABEL: Record<ScheduledJobRow["health"], string> = {
  ok: "on schedule",
  overdue: "overdue",
  // Not a fault: the job redirects nowhere, so no run was ever going to be
  // recorded. Saying "unknown" would imply something went wrong.
  unobservable: "cron log unreadable",
  unknown: "schedule not read",
};

function Dot({ kind }: { kind: string }) {
  return (
    <span
      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[kind] ?? "bg-white/25"}`}
      aria-hidden
    />
  );
}

/**
 * Everything that runs on a schedule, in one place: the probes from the most
 * recent run, and mediabox's cron jobs.
 *
 * Two lists rather than one merged one, because they answer different
 * questions. A probe says whether something is *true right now*; a cron entry
 * says whether something is *still running at all*. Merging them would mean a
 * row whose status column meant two different things depending on its origin.
 *
 * The whole panel is width-capped with its own scroll region. Some of these
 * commands are 200 characters of shell, and letting them set the width pushed
 * every other panel on the page out of shape -- so long values scroll inside
 * their row instead of widening the page.
 */
export function ScheduledJobsPanel({
  probes,
  probeRanAt,
  jobs,
  cronGeneratedAt,
  cronReachable,
}: {
  probes: ProbeLine[];
  probeRanAt: string | null;
  jobs: ScheduledJobRow[];
  cronGeneratedAt: string | null;
  cronReachable: boolean;
}) {
  const [showCommands, setShowCommands] = useState(false);

  const probeFailures = probes.filter((p) => p.status === "fail").length;
  const jobProblems = jobs.filter((j) => j.health === "overdue").length;

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50">
        <span>
          {probes.length} probe{probes.length === 1 ? "" : "s"}
          {probeFailures > 0 && <span className="text-red-300"> · {probeFailures} failing</span>}
          {probeRanAt && <span> · ran {timeAgo(probeRanAt)}</span>}
        </span>
        <span>
          {jobs.length} cron job{jobs.length === 1 ? "" : "s"}
          {jobProblems > 0 && <span className="text-red-300"> · {jobProblems} overdue</span>}
          {cronGeneratedAt && <span> · listed {timeAgo(cronGeneratedAt)}</span>}
        </span>
        <button
          type="button"
          onClick={() => setShowCommands((v) => !v)}
          className="ml-auto rounded border border-white/15 px-2 py-0.5 text-white/60 transition-colors hover:bg-white/10"
        >
          {showCommands ? "Hide commands" : "Show commands"}
        </button>
      </div>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/30">
          Probes
        </h3>
        {probes.length === 0 ? (
          <p className="text-sm text-white/50">
            No probe run recorded yet. Runs every six hours via GitHub Actions.
          </p>
        ) : (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {probes.map((probe) => (
              <li
                key={probe.name}
                className="flex items-start gap-2 rounded border border-white/10 bg-black/20 px-3 py-2"
              >
                <Dot kind={probe.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-white/80">{probe.name}</p>
                  {probe.detail && (
                    <p className="mt-0.5 break-words text-[11px] text-white/45">{probe.detail}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 text-[10px] uppercase tracking-wide ${
                    probe.status === "fail"
                      ? "text-red-300"
                      : probe.status === "skip"
                        ? "text-white/30"
                        : "text-emerald-300/70"
                  }`}
                >
                  {probe.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/30">
          Cron jobs on mediabox
        </h3>
        {!cronReachable ? (
          <p className="text-sm text-white/50">
            Couldn&rsquo;t read the schedule from mediabox. Published by
            scripts/cron-inventory.py every 15 minutes; needs FLASH_LIBRARY_URL set.
          </p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-white/50">mediabox reports nothing scheduled.</p>
        ) : (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {jobs.map((job) => (
              <li
                key={`${job.user}:${job.name}:${job.schedule}`}
                className="flex items-start gap-2 rounded border border-white/10 bg-black/20 px-3 py-2"
              >
                <Dot kind={job.health} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-xs text-white/80">{job.name}</span>
                    <code className="shrink-0 text-[10px] text-white/40">{job.schedule}</code>
                    <span className="shrink-0 text-[10px] text-white/30">{job.user}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-white/45">
                    {job.lastRun ? `ran ${timeAgo(job.lastRun)}` : HEALTH_LABEL[job.health]}
                    {/* Output age only when it lags the run: a job that is
                        running but has written nothing for weeks is worth
                        noticing, and repeating the same value twice is not. */}
                    {job.lastRun &&
                      job.lastOutput &&
                      Date.parse(job.lastOutput) < Date.parse(job.lastRun) - 3600_000 && (
                        <span className="text-white/30">
                          {" "}
                          · last output {timeAgo(job.lastOutput)}
                        </span>
                      )}
                    {job.health === "overdue" && (
                      <span className="text-red-300"> · overdue</span>
                    )}
                  </p>
                  {showCommands && (
                    // Its own scroll box: these run to 200 characters of shell
                    // and must not set the width of the page.
                    <pre className="mt-1 max-w-full whitespace-pre-wrap break-all rounded bg-black/40 px-2 py-1 text-[10px] leading-relaxed text-white/50">
                      {job.command}
                    </pre>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
