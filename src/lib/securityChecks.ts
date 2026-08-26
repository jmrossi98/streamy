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

const MONITORED_SERVICES: { name: string; port: number }[] = [
  { name: "Ollama", port: 11434 },
  { name: "SearXNG", port: 8888 },
  { name: "Radarr", port: 7878 },
  { name: "Sonarr", port: 8989 },
  { name: "qBittorrent", port: 8080 },
  { name: "Prowlarr", port: 9696 },
  { name: "Jellyfin", port: 8096 },
];

/** IPv6 literals need brackets in a URL; IPv4 and hostnames must not have them. */
function toUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * Probes the monitored services against the given public addresses.
 *
 * Scope, stated plainly because an over-claimed security check is worse than a
 * missing one: this proves those ports do not answer at the addresses given. It
 * says nothing about addresses not supplied, and nothing about services bound
 * only to the tailnet. Point it at the home network's public addresses -- aimed
 * at this box's own, it is close to vacuous, since the services live elsewhere.
 */
export async function checkExposure(
  publicHost: string | null,
  publicHostV6?: string | null
): Promise<Finding[]> {
  const targets = [
    publicHost ? { host: publicHost, family: "IPv4" as const } : null,
    // IPv6 is checked separately because there is no NAT in front of it. An
    // IPv4 address is shielded by the router doing address translation, so a
    // service is unreachable unless a port was forwarded deliberately. Every
    // device with a global IPv6 address is directly addressable, and the only
    // thing in the way is the router's firewall -- so a clean IPv4 result says
    // nothing at all about IPv6, and reporting it as "not exposed" would be a
    // false pass.
    publicHostV6 ? { host: publicHostV6, family: "IPv6" as const } : null,
  ].filter((t): t is { host: string; family: "IPv4" | "IPv6" } => t !== null);

  if (targets.length === 0) return [];

  const findings = await Promise.all(
    targets.flatMap((target) =>
      MONITORED_SERVICES.map(async (s) => {
        const hostForUrl = toUrlHost(target.host);
        const reachable = await isPubliclyReachable(`http://${hostForUrl}:${s.port}/`);
        return assessExposure(
          `${s.name} (${target.family})`,
          reachable,
          reachable
            ? `${s.name} answered on ${hostForUrl}:${s.port} over ${target.family}.`
            : `No response on ${hostForUrl}:${s.port} over ${target.family}.`
        );
      })
    )
  );

  return findings;
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
    checkExposure(
      process.env.PUBLIC_PROBE_HOST ?? null,
      process.env.PUBLIC_PROBE_HOST_V6 ?? null
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    activity,
    findings: [...assessLoginActivity(activity), ...adminFindings, ...exposureFindings],
  };
}
