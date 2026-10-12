/**
 * Deciding when a service that is not answering is worth an alert. Pure.
 *
 * The services panel shows what is down, but only to someone looking at it,
 * and the scheduled probes deliberately checked other things -- stale files,
 * stuck imports, search yield. So a service could sit down for hours and
 * nothing said so: on 2026-10-12 Prowlarr, FlareSolverr, Dispatcharr and
 * Radarr were each down at times, seen only because the panel happened to be
 * open.
 *
 * A single failed check is not an outage. These services restart themselves
 * and are restarted on purpose (a VPN rotation takes four of them down for
 * half a minute), so a service is reported only once it has been down on
 * consecutive checks, once per outage, and again when it is back.
 */
import type { ProbeResult } from "./healthProbeRules";

export type WatchedService = { name: string; state: string; detail: string };

/** Consecutive failed checks before a service counts as down. */
export const DOWN_CHECKS_BEFORE_ALERT = 2;

export type WatchState = {
  /** Service name -> consecutive checks it has been down. */
  streaks: Record<string, number>;
  /** Services an alert has already gone out for. */
  alerted: string[];
};

export const EMPTY_WATCH: WatchState = { streaks: {}, alerted: [] };

export type WatchOutcome = {
  state: WatchState;
  /** Down long enough to say so, and not yet said. */
  newlyDown: WatchedService[];
  /** Alerted earlier, answering again now. */
  recovered: string[];
};

/**
 * One check's worth of bookkeeping. "unknown" (the check could not run) and
 * "unconfigured" neither start nor end an outage: only a verified "down"
 * counts against a service, and only a verified "up" clears it.
 */
export function watchServices(previous: WatchState, statuses: WatchedService[]): WatchOutcome {
  const streaks: Record<string, number> = {};
  const alerted = new Set(previous.alerted);
  const newlyDown: WatchedService[] = [];
  const recovered: string[] = [];

  for (const s of statuses) {
    if (s.state === "down") {
      streaks[s.name] = (previous.streaks[s.name] ?? 0) + 1;
      if (streaks[s.name] >= DOWN_CHECKS_BEFORE_ALERT && !alerted.has(s.name)) {
        alerted.add(s.name);
        newlyDown.push(s);
      }
    } else if (s.state === "up") {
      if (alerted.delete(s.name)) recovered.push(s.name);
    } else if (previous.streaks[s.name]) {
      streaks[s.name] = previous.streaks[s.name];
    }
  }
  return { state: { streaks, alerted: [...alerted] }, newlyDown, recovered };
}

/** The scheduled probe: every service that was down on both of two looks. */
export function servicesVerdict(downTwice: WatchedService[] | null, checked: number): ProbeResult {
  const id = "services.answering";
  const name = "Every configured service answers";
  if (downTwice === null) return { id, name, status: "skip", detail: "the services check could not run" };
  if (downTwice.length === 0) return { id, name, status: "pass", detail: `${checked} services checked, none down` };
  return {
    id,
    name,
    status: "fail",
    detail: downTwice.map((s) => `${s.name} is down (${s.detail})`).join("; "),
  };
}
