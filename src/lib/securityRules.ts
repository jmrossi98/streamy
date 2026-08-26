/**
 * How raw auth activity becomes a security finding.
 *
 * Pure, so the thresholds are testable without a database or a network --
 * same split as downloadHealthRules.ts and loginAttemptRules.ts.
 *
 * The thresholds are deliberately conservative. This instance sees a handful of
 * legitimate sign-ins a day from a few people, so anything resembling volume is
 * already anomalous. An alert that fires on ordinary use gets muted, and a muted
 * alert is worse than none.
 */

export type Severity = "critical" | "warning" | "info";

export type Finding = {
  /** Stable identifier -- alerting dedupes on this, so it must not embed counts. */
  id: string;
  severity: Severity;
  title: string;
  detail: string;
};

export type LoginActivity = {
  failuresLast24h: number;
  successesLast24h: number;
  /** Distinct source addresses that failed at least once. */
  distinctFailedIps: number;
  /** Worst single offender in the window. */
  topIp: { ip: string; failures: number } | null;
  /** Attempts against names that don't exist -- probing, not typos. */
  unknownUserAttempts: number;
  /** Requests refused because a lockout was already active. */
  lockedOutAttempts: number;
  /** Accounts created in the window. */
  signups: number;
};

/** One address grinding a password. */
export const SUSTAINED_ATTACK_FAILURES = 20;
/** Total failures across everything -- catches what per-IP limits miss. */
export const ELEVATED_FAILURE_VOLUME = 50;
/** Many addresses failing at once: a distributed attempt, or a shared exit. */
export const DISTRIBUTED_SOURCE_COUNT = 10;
/** Guessing at names that don't exist is enumeration, not a typo. */
export const ENUMERATION_ATTEMPTS = 10;
/** More new accounts than this instance plausibly gains in a day. */
export const UNUSUAL_SIGNUP_COUNT = 5;

export function assessLoginActivity(a: LoginActivity): Finding[] {
  const findings: Finding[] = [];

  if (a.topIp && a.topIp.failures >= SUSTAINED_ATTACK_FAILURES) {
    findings.push({
      id: "auth.sustained_attack",
      severity: "critical",
      title: "Sustained password guessing from one address",
      detail:
        `${a.topIp.ip} failed ${a.topIp.failures} sign-ins in 24h. ` +
        `Rate limiting is throttling it, but the source is persistent.`,
    });
  }

  if (a.failuresLast24h >= ELEVATED_FAILURE_VOLUME) {
    findings.push({
      id: "auth.failure_volume",
      severity: "warning",
      title: "Elevated failed sign-in volume",
      detail: `${a.failuresLast24h} failures in 24h across ${a.distinctFailedIps} address(es).`,
    });
  }

  // Spraying: one guess each against many accounts never trips a per-account
  // counter, so volume alone can look unremarkable.
  if (a.distinctFailedIps >= DISTRIBUTED_SOURCE_COUNT) {
    findings.push({
      id: "auth.distributed_sources",
      severity: "warning",
      title: "Failed sign-ins from many distinct addresses",
      detail:
        `${a.distinctFailedIps} addresses failed at least once in 24h. ` +
        `Consistent with spraying rather than one person mistyping.`,
    });
  }

  if (a.unknownUserAttempts >= ENUMERATION_ATTEMPTS) {
    findings.push({
      id: "auth.enumeration",
      severity: "warning",
      title: "Probing for accounts that don't exist",
      detail:
        `${a.unknownUserAttempts} attempts against unknown names in 24h. ` +
        `Names are public on the profile picker, so this is guessing, not discovery.`,
    });
  }

  if (a.signups >= UNUSUAL_SIGNUP_COUNT) {
    findings.push({
      id: "auth.signup_spike",
      severity: "warning",
      title: "Unusual number of new accounts",
      detail: `${a.signups} accounts created in 24h. Each one is an unauthenticated write.`,
    });
  }

  // Informational: the throttle doing its job is reassuring, not alarming, and
  // it is the only positive signal that rate limiting is actually engaged.
  if (a.lockedOutAttempts > 0) {
    findings.push({
      id: "auth.lockouts_active",
      severity: "info",
      title: "Rate limiting engaged",
      detail: `${a.lockedOutAttempts} attempt(s) refused by an active lockout in 24h.`,
    });
  }

  return findings;
}

/**
 * A service that answers from the public internet when it was never meant to.
 *
 * The worst case in this stack is Ollama, which has no authentication at all --
 * if it is publicly reachable, anyone can use the GPU and read every prompt.
 * SearXNG and the *arr APIs are close behind.
 */
export function assessExposure(
  service: string,
  reachablePublicly: boolean,
  note?: string
): Finding {
  return reachablePublicly
    ? {
        id: `exposure.${service}`,
        severity: "critical",
        title: `${service} is reachable from the public internet`,
        detail:
          note ??
          `${service} is meant to be reachable only over the tailnet or loopback.`,
      }
    : {
        id: `exposure.${service}`,
        severity: "info",
        title: `${service} is not publicly reachable`,
        detail: note ?? "Confirmed unreachable from outside the tailnet.",
      };
}

/** Highest severity present, for a single at-a-glance status. */
export function overallSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  return "info";
}
