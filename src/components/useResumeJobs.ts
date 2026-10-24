"use client";

import { useCallback, useEffect, useState } from "react";
import { isActive, type ResumeJobView } from "@/lib/resumeJobRules";

/** How often a running job is polled. */
const POLL_MS = 3_000;

/** What a listing's Tailor button shows: a job, a start in flight, or why the start failed. */
export type TailorState = ResumeJobView | { starting: true } | { startError: string };

export function isJob(s: TailorState | undefined): s is ResumeJobView {
  return !!s && "status" in s;
}

/** "1:07" from a start time to now. */
export function elapsed(startedAt: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Tailoring jobs per posting, polled while they run.
 *
 * 2026-10-24: seeded from the server's recent jobs, so a reload or a phone
 * coming back from sleep shows the real state -- the run still going, or the
 * resume it made -- rather than a fresh button. Polls again the moment the
 * tab becomes visible, since a sleeping phone skips its timers.
 */
export function useResumeJobs(initial: Record<string, ResumeJobView>) {
  const [jobs, setJobs] = useState<Record<string, TailorState>>(initial);
  const [now, setNow] = useState(() => Date.now());

  const activeIds = Object.values(jobs)
    .filter((j): j is ResumeJobView => isJob(j) && isActive(j.status))
    .map((j) => j.id)
    .join(",");

  const poll = useCallback(async (ids: string[]) => {
    const fresh = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`/api/admin/jobs/resume/${encodeURIComponent(id)}`, { cache: "no-store" });
          if (!res.ok) return null;
          return ((await res.json()) as { job?: ResumeJobView }).job ?? null;
        } catch {
          return null; // Offline for a moment: the next poll tries again.
        }
      })
    );
    setJobs((prev) => {
      const next = { ...prev };
      for (const job of fresh) if (job) next[job.postingId] = job;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!activeIds) return;
    const ids = activeIds.split(",");
    const pollTimer = setInterval(() => void poll(ids), POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void poll(ids);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(pollTimer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activeIds, poll]);

  const start = useCallback(async (postingId: string) => {
    setJobs((prev) => ({ ...prev, [postingId]: { starting: true } }));
    setNow(Date.now());
    try {
      const res = await fetch("/api/admin/jobs/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId }),
      });
      const data = (await res.json().catch(() => ({}))) as { job?: ResumeJobView; error?: string };
      setJobs((prev) => ({
        ...prev,
        [postingId]: res.ok && data.job ? data.job : { startError: data.error ?? `Couldn't start (HTTP ${res.status})` },
      }));
    } catch {
      setJobs((prev) => ({ ...prev, [postingId]: { startError: "Network error — check the connection and retry" } }));
    }
  }, []);

  return { jobs, now, start };
}
