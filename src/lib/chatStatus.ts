/**
 * The probing half of the chat's live stack context.
 *
 * Split from chatContext.ts, which stays pure so it can be tested without the
 * database client -- getServiceStatuses reaches Prisma through sonarr/tmdb, and
 * CI's unit-test step deliberately runs without `prisma generate`. Same split
 * as pageWatch vs pageWatchRules.
 */

import { getServiceStatuses, type ServiceStatus } from "./serviceStatus";
import {
  containerProblems,
  getContainerLogs,
  listContainers,
  staleNamespaceBindings,
  type ContainerState,
} from "./containers";

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

/**
 * Log tail fetched per flagged container, capped regardless of how many are
 * actually broken.
 *
 * Bounded on purpose: a bad deploy can leave a dozen containers unhealthy at
 * once (a shared dependency, a bad image tag), and pulling 60 lines from each
 * of them would both hammer Portainer on every uncached snapshot and hand a
 * 3B model with an 8k window more log text than question. The two or three
 * most-likely-relevant (problems first, then stale bindings) is enough to
 * diagnose the common case -- one or two things actually broken -- without
 * drowning a genuinely bad night in its own noise.
 */
const MAX_CONTAINERS_TO_LOG = 3;
const LOG_TAIL_LINES = 60;

let cached: {
  at: number;
  statuses: ServiceStatus[];
  containers: ContainerState[] | null;
  logs: Record<string, string>;
} | null = null;

/** Drops the memoised snapshot. */
export function clearStatusSnapshot(): void {
  cached = null;
}

export async function getStatusSnapshot(now = Date.now()): Promise<ServiceStatus[]> {
  return (await getSnapshot(now)).statuses;
}

/**
 * Service probes, container state, and logs for whatever is flagged, together.
 *
 * Fetched in parallel and cached as one unit: they are read together and a
 * container fault is usually the explanation for a service probe failing, so
 * letting them drift apart in time would let the chat describe a service as
 * down while reporting its container as healthy.
 *
 * Logs are a second wave, not part of the first Promise.all: which containers
 * are worth reading logs for depends on the container list this same call
 * just fetched, so it cannot be requested until that answer is in.
 */
export async function getSnapshot(now = Date.now()): Promise<{
  statuses: ServiceStatus[];
  containers: ContainerState[] | null;
  /** Container name -> recent log tail. Only ever populated for flagged containers. */
  logs: Record<string, string>;
}> {
  if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached;
  const [statuses, containers] = await Promise.all([
    getServiceStatuses(),
    listContainers(),
  ]);

  const logs: Record<string, string> = {};
  if (containers) {
    const stale = staleNamespaceBindings(containers);
    const problems = containerProblems(containers).filter(
      (c) => !stale.some((s) => s.name === c.name)
    );
    const toRead = [...problems, ...stale].slice(0, MAX_CONTAINERS_TO_LOG);
    const fetched = await Promise.all(
      toRead.map((c) => getContainerLogs(c.id, LOG_TAIL_LINES))
    );
    toRead.forEach((c, i) => {
      const text = fetched[i];
      if (text) logs[c.name] = text;
    });
  }

  cached = { at: now, statuses, containers, logs };
  return cached;
}
