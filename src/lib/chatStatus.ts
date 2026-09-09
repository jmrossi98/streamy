/**
 * The probing half of the chat's live stack context.
 *
 * Split from chatContext.ts, which stays pure so it can be tested without the
 * database client -- getServiceStatuses reaches Prisma through sonarr/tmdb, and
 * CI's unit-test step deliberately runs without `prisma generate`. Same split
 * as pageWatch vs pageWatchRules.
 */

import { getServiceStatuses, type ServiceStatus } from "./serviceStatus";

/**
 * How long a snapshot is reused across turns.
 *
 * getServiceStatuses() fires ~22 live probes. Re-running it on every message of
 * a back-and-forth would put the whole stack under load proportional to how
 * chatty the admin is, for numbers that barely move in that window. Short
 * enough that restarting a service and asking again gets a fresh answer rather
 * than a confusing stale one.
 */
export const SNAPSHOT_TTL_MS = 15_000;

let cached: { at: number; statuses: ServiceStatus[] } | null = null;

/** Drops the memoised snapshot. */
export function clearStatusSnapshot(): void {
  cached = null;
}

export async function getStatusSnapshot(now = Date.now()): Promise<ServiceStatus[]> {
  if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached.statuses;
  const statuses = await getServiceStatuses();
  cached = { at: now, statuses };
  return statuses;
}
