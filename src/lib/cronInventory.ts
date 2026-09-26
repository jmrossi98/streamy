/**
 * mediabox's cron inventory, as published by scripts/cron-inventory.py.
 *
 * Kept apart from scheduledJobs.ts, which is pure: this is the part that talks
 * to the network, so the judgement rules stay testable without it.
 */
import type { CronJob } from "./scheduledJobs";

const TIMEOUT_MS = 6_000;

export type CronInventory = {
  generatedAt: string | null;
  jobs: CronJob[];
};

/**
 * Returns null rather than throwing or returning an empty inventory.
 *
 * The distinction matters to the panel: no jobs means "the box says it has
 * nothing scheduled", which would be alarming, while null means "we could not
 * ask" -- and those must not look the same.
 */
export async function fetchCronInventory(): Promise<CronInventory | null> {
  const base = process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "");
  if (!base) return null;
  try {
    const res = await fetch(`${base}/status/cron-jobs.json`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { generatedAt?: string; jobs?: unknown };
    if (!Array.isArray(body?.jobs)) return null;
    return {
      generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : null,
      jobs: body.jobs as CronJob[],
    };
  } catch {
    return null;
  }
}
