/**
 * The probing half of the chat's live stack context.
 *
 * Split from chatContext.ts, which stays pure so it can be tested without the
 * database client -- getServiceStatuses reaches Prisma through sonarr/tmdb, and
 * CI's unit-test step deliberately runs without `prisma generate`. Same split
 * as pageWatch vs pageWatchRules.
 */

import { getServiceStatuses, type ServiceStatus } from "./serviceStatus";
import { listContainers, type ContainerState } from "./containers";

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

let cached: {
  at: number;
  statuses: ServiceStatus[];
  containers: ContainerState[] | null;
} | null = null;

/** Drops the memoised snapshot. */
export function clearStatusSnapshot(): void {
  cached = null;
}

export async function getStatusSnapshot(now = Date.now()): Promise<ServiceStatus[]> {
  return (await getSnapshot(now)).statuses;
}

/**
 * Service probes and container state together.
 *
 * Fetched in parallel and cached as one unit: they are read together and a
 * container fault is usually the explanation for a service probe failing, so
 * letting them drift apart in time would let the chat describe a service as
 * down while reporting its container as healthy.
 */
export async function getSnapshot(now = Date.now()): Promise<{
  statuses: ServiceStatus[];
  containers: ContainerState[] | null;
}> {
  if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached;
  const [statuses, containers] = await Promise.all([
    getServiceStatuses(),
    listContainers(),
  ]);
  cached = { at: now, statuses, containers };
  return cached;
}
