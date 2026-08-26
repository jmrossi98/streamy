/**
 * Security monitoring: reads the auth log and probes for services that should
 * not be answering from the public internet.
 *
 * Read-only by construction. It never blocks, bans, or reconfigures anything --
 * it reports. Automated blocking on a box only a handful of people use is a
 * good way to lock yourself out of your own media server on a bad guess.
 */

import { prisma } from "./db";
import {
  assessExposure,
  assessLoginActivity,
  type Finding,
  type LoginActivity,
} from "./securityRules";

const WINDOW_HOURS = 24;
const PROBE_TIMEOUT_MS = 4_000;

/** Aggregates the LoginAttempt table over the reporting window. */
export async function getLoginActivity(): Promise<LoginActivity> {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  const [failures, successes, unknownUser, lockedOut, signups, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { success: false, at: { gte: since } } }),
    prisma.loginAttempt.count({ where: { success: true, at: { gte: since } } }),
    prisma.loginAttempt.count({ where: { outcome: "unknown_user", at: { gte: since } } }),
    prisma.loginAttempt.count({ where: { outcome: "locked_out", at: { gte: since } } }),
    prisma.loginAttempt.count({ where: { outcome: "signup", at: { gte: since } } }),
    prisma.loginAttempt.groupBy({
      by: ["ip"],
      where: { success: false, at: { gte: since } },
      _count: { ip: true },
      orderBy: { _count: { ip: "desc" } },
      take: 1,
    }),
  ]);

  const distinctFailedIps = await prisma.loginAttempt
    .groupBy({ by: ["ip"], where: { success: false, at: { gte: since } } })
    .then((rows) => rows.length);

  const worst = byIp[0];

  return {
    failuresLast24h: failures,
    successesLast24h: successes,
    distinctFailedIps,
    topIp: worst ? { ip: worst.ip, failures: worst._count.ip } : null,
    unknownUserAttempts: unknownUser,
    lockedOutAttempts: lockedOut,
    signups,
  };
}

/**
 * Whether a host:port answers from outside the tailnet.
 *
 * This runs on Lightsail, which has a public vantage point, so the check is
 * meaningful: if a tailnet-only service answers a request aimed at a public
 * address, it is exposed. A refused connection or a timeout is the healthy
 * outcome -- hence the inverted-looking logic.
 */
async function isPubliclyReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "manual",
    });
    // Any HTTP response at all -- including 401 or 403 -- means something is
    // listening and routable. That is the finding.
    return true;
  } catch {
    return false;
  }
}

/**
 * Probes the internal services on the box's own public address.
 *
 * Deliberately narrow: it proves these ports are not open on the public
 * interface of the host running the check. It cannot prove the *home* network
 * isn't exposing them, which would need a probe originating outside that
 * network against its public IP. Stated plainly rather than implied, because
 * an over-claimed security check is worse than a missing one.
 */
export async function checkExposure(publicHost: string | null): Promise<Finding[]> {
  if (!publicHost) return [];

  const services: { name: string; port: number }[] = [
    { name: "Ollama", port: 11434 },
    { name: "SearXNG", port: 8888 },
    { name: "Radarr", port: 7878 },
    { name: "Sonarr", port: 8989 },
    { name: "qBittorrent", port: 8080 },
    { name: "Prowlarr", port: 9696 },
  ];

  return Promise.all(
    services.map(async (s) => {
      const reachable = await isPubliclyReachable(`http://${publicHost}:${s.port}/`);
      return assessExposure(
        s.name,
        reachable,
        reachable
          ? `${s.name} answered on ${publicHost}:${s.port} from the public interface.`
          : `No response on ${publicHost}:${s.port} — not open on this host's public interface.`
      );
    })
  );
}

/** More than one admin is worth seeing, since nothing in the UI creates one. */
export async function checkAdminAccounts(): Promise<Finding[]> {
  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { name: true, approved: true },
  });

  if (admins.length === 0) {
    return [
      {
        id: "admin.none",
        severity: "warning",
        title: "No admin account exists",
        detail: "ADMIN_NAME will claim the role on next sign-in. Expected right after the migration.",
      },
    ];
  }

  if (admins.length > 1) {
    return [
      {
        id: "admin.multiple",
        severity: "critical",
        title: "More than one admin account",
        detail:
          `${admins.length} accounts hold the admin role: ${admins.map((a) => a.name).join(", ")}. ` +
          `Nothing in the UI grants it, so an unexpected one warrants investigation.`,
      },
    ];
  }

  return [
    {
      id: "admin.single",
      severity: "info",
      title: "Single admin account",
      detail: `${admins[0].name}${admins[0].approved ? "" : " (not approved)"}.`,
    },
  ];
}

export type SecurityReport = {
  generatedAt: string;
  activity: LoginActivity;
  findings: Finding[];
};

export async function runSecurityChecks(): Promise<SecurityReport> {
  const activity = await getLoginActivity();

  const [adminFindings, exposureFindings] = await Promise.all([
    checkAdminAccounts(),
    checkExposure(process.env.PUBLIC_PROBE_HOST ?? null),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    activity,
    findings: [...assessLoginActivity(activity), ...adminFindings, ...exposureFindings],
  };
}
