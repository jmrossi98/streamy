/**
 * At-a-glance status for every service in the stack.
 *
 * One probe per service, run in parallel, each with its own short timeout so a
 * single dead box can't hold up the admin page. Unconfigured services report as
 * "not configured" rather than "down" -- the distinction matters, since an
 * optional integration nobody set up is not an outage.
 *
 * Read-only, like everything else in the ops surface.
 */

import { isRadarrConfigured } from "./radarr";
import { isSonarrConfigured } from "./sonarr";
import { isJellyfinConfigured } from "./jellyfin";
import { isQbittorrentConfigured } from "./qbittorrent";
import { getOllamaStatus, isOllamaConfigured, ollamaModel } from "./ollama";
import { isWebSearchConfigured } from "./webSearch";
import { connect } from "node:tls";
import { statfs, stat } from "node:fs/promises";
import { geoStatus } from "./geoip";
import { checkBlogAccess } from "./githubPublish";
import { checkEgress } from "./pageWatch";
import { isNotifyConfigured } from "./notify";
import { prisma } from "./db";

const PROBE_TIMEOUT_MS = 5_000;

export type ServiceState = "up" | "down" | "unconfigured";

export type ServiceStatus = {
  name: string;
  /** Grouping for the panel: what this service is for. */
  group: "Media" | "Downloads" | "Assistant" | "System";
  state: ServiceState;
  /** Short human detail: version, model, error reason. */
  detail: string;
};

const env = (k: string) => process.env[k]?.replace(/\/$/, "") ?? "";

async function probe(
  url: string,
  headers: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; json?: unknown; error?: string }> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      /* not json; the status code is still the useful part */
    }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Shared probe for the *arr family, which share an API shape but not an API
 * version: Radarr and Sonarr are on v3, while Prowlarr (like Lidarr and
 * Readarr) is still on v1. Hardcoding v3 makes Prowlarr answer 404 and report
 * itself down even when it is running and correctly configured, so the version
 * is per-service rather than assumed.
 */
async function servarrStatus(
  name: string,
  group: ServiceStatus["group"],
  base: string,
  key: string,
  configured: boolean,
  apiVersion: "v1" | "v3" = "v3"
): Promise<ServiceStatus> {
  if (!configured) return { name, group, state: "unconfigured", detail: "Not configured" };

  const res = await probe(`${base}/api/${apiVersion}/system/status`, { "X-Api-Key": key });
  if (!res.ok) {
    return {
      name,
      group,
      state: "down",
      detail: res.error ?? `HTTP ${res.status}`,
    };
  }
  const version = (res.json as { version?: string } | undefined)?.version;
  return { name, group, state: "up", detail: version ? `v${version}` : "reachable" };
}

async function jellyfinStatus(): Promise<ServiceStatus> {
  const group = "Media" as const;
  if (!isJellyfinConfigured()) {
    return { name: "Jellyfin", group, state: "unconfigured", detail: "Not configured" };
  }
  const res = await probe(`${env("JELLYFIN_URL")}/System/Info`, {
    "X-Emby-Token": process.env.JELLYFIN_API_KEY ?? "",
  });
  if (!res.ok) {
    return { name: "Jellyfin", group, state: "down", detail: res.error ?? `HTTP ${res.status}` };
  }
  const info = res.json as { Version?: string } | undefined;
  return { name: "Jellyfin", group, state: "up", detail: info?.Version ? `v${info.Version}` : "reachable" };
}

/**
 * qBittorrent plus the VPN check that matters most: torrent traffic must not
 * leave from the home connection. Reported together because a torrent client
 * that is up but unprotected is worse than one that is down.
 */
async function qbittorrentStatus(): Promise<ServiceStatus[]> {
  const group = "Downloads" as const;
  if (!isQbittorrentConfigured()) {
    return [
      { name: "qBittorrent", group, state: "unconfigured", detail: "Not configured" },
      { name: "VPN", group, state: "unconfigured", detail: "Needs qBittorrent to check" },
    ];
  }

  const base = env("QBITTORRENT_URL");
  try {
    const login = await fetch(`${base}/api/v2/auth/login`, {
      method: "POST",
      headers: { Referer: base, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: process.env.QBITTORRENT_USER ?? "",
        password: process.env.QBITTORRENT_PASSWORD ?? "",
      }).toString(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const cookie = login.headers.get("set-cookie")?.match(/(QBT_SID[^=]*=[^;]+)/)?.[1];
    if (!login.ok || !cookie) {
      return [
        { name: "qBittorrent", group, state: "down", detail: `auth failed (HTTP ${login.status})` },
        { name: "VPN", group, state: "down", detail: "Can't check without qBittorrent" },
      ];
    }

    const info = await fetch(`${base}/api/v2/transfer/info`, {
      headers: { Cookie: cookie, Referer: base },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const t = (await info.json().catch(() => ({}))) as {
      connection_status?: string;
      last_external_address_v4?: string;
    };

    const client: ServiceStatus = {
      name: "qBittorrent",
      group,
      state: t.connection_status === "disconnected" ? "down" : "up",
      // "firewalled" is expected without port forwarding: slower, not broken.
      detail: t.connection_status === "firewalled"
        ? "connected (no port forwarding)"
        : t.connection_status ?? "reachable",
    };

    const torrentIp = t.last_external_address_v4;
    let vpn: ServiceStatus;
    if (!torrentIp) {
      vpn = { name: "VPN", group, state: "down", detail: "No external address reported" };
    } else {
      // Compared against this host's own public IP. Equal means the tunnel is
      // not carrying torrent traffic.
      const direct = await probe("https://api.ipify.org?format=json");
      const hostIp = (direct.json as { ip?: string } | undefined)?.ip;
      vpn = hostIp && torrentIp === hostIp
        ? { name: "VPN", group, state: "down", detail: `Torrents leaving from ${hostIp} — NOT protected` }
        : { name: "VPN", group, state: "up", detail: `Torrents exit via ${torrentIp}` };
    }

    return [client, vpn];
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return [
      { name: "qBittorrent", group, state: "down", detail },
      { name: "VPN", group, state: "down", detail: "Can't check without qBittorrent" },
    ];
  }
}

async function ollamaServiceStatus(): Promise<ServiceStatus> {
  const group = "Assistant" as const;
  if (!isOllamaConfigured()) {
    return { name: "Ollama", group, state: "unconfigured", detail: "Not configured" };
  }
  const status = await getOllamaStatus();
  if (!status.ok) return { name: "Ollama", group, state: "down", detail: status.error };
  return {
    name: "Ollama",
    group,
    state: "up",
    detail: status.loaded ? ollamaModel() : `${ollamaModel()} (not pulled)`,
  };
}

async function searxngStatus(): Promise<ServiceStatus> {
  const group = "Assistant" as const;
  if (!isWebSearchConfigured()) {
    return { name: "SearXNG", group, state: "unconfigured", detail: "Not configured" };
  }
  // Queries the JSON API rather than the homepage: the homepage answers even
  // when JSON output is disabled, which is the failure mode that actually
  // breaks search.
  const res = await probe(`${env("SEARXNG_URL")}/search?q=ping&format=json`);
  if (!res.ok) {
    return {
      name: "SearXNG",
      group,
      state: "down",
      detail: res.status === 403 ? "JSON format disabled in settings.yml" : res.error ?? `HTTP ${res.status}`,
    };
  }
  return { name: "SearXNG", group, state: "up", detail: "JSON API responding" };
}

const SYSTEM = "System" as const;

/** GeoLite2 database backing the visitor map. */
async function geoipStatus(): Promise<ServiceStatus> {
  const s = await geoStatus();
  if (!s.configured) {
    return { name: "GeoLite2", group: SYSTEM, state: "unconfigured", detail: "No MAXMIND_LICENSE_KEY" };
  }
  if (s.present) {
    const age = s.ageDays === 0 ? "today" : `${s.ageDays}d ago`;
    return { name: "GeoLite2", group: SYSTEM, state: "up", detail: `database updated ${age}` };
  }
  // Not present: either still downloading, or the key is bad.
  return {
    name: "GeoLite2",
    group: SYSTEM,
    state: "down",
    detail: s.error ? `download failing: ${s.error}` : "downloading…",
  };
}

/** Whether the blog-publishing token can still write to the website repo. */
async function blogTokenStatus(): Promise<ServiceStatus> {
  const a = await checkBlogAccess();
  if (a.detail === "GITHUB_BLOG_TOKEN unset") {
    return { name: "Blog token", group: SYSTEM, state: "unconfigured", detail: "Not configured" };
  }
  return {
    name: "Blog token",
    group: SYSTEM,
    state: a.ok && a.canWrite ? "up" : "down",
    detail: a.detail,
  };
}

/**
 * TLS certificate expiry for the public domain.
 *
 * Reads the live certificate the way an external client would -- a raw TLS
 * connection to the domain -- rather than trusting that Caddy's auto-renew is
 * working. rejectUnauthorized is off because the goal is to READ the cert
 * (including an already-expired one), not to validate the chain.
 */
async function tlsCertStatus(): Promise<ServiceStatus> {
  const url = env("NEXTAUTH_URL");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { name: "TLS cert", group: SYSTEM, state: "unconfigured", detail: "No NEXTAUTH_URL" };
  }

  return await new Promise((resolve) => {
    const socket = connect(
      { host, port: 443, servername: host, rejectUnauthorized: false, timeout: PROBE_TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.valid_to) {
          resolve({ name: "TLS cert", group: SYSTEM, state: "down", detail: "no certificate" });
          return;
        }
        const daysLeft = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
        resolve({
          name: "TLS cert",
          group: SYSTEM,
          state: daysLeft <= 0 ? "down" : "up",
          detail:
            daysLeft <= 0
              ? "expired"
              : daysLeft <= 14
                ? `expires in ${daysLeft}d — renewal may be stuck`
                : `valid for ${daysLeft}d`,
        });
      }
    );
    socket.on("error", (e) => resolve({ name: "TLS cert", group: SYSTEM, state: "down", detail: e.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ name: "TLS cert", group: SYSTEM, state: "down", detail: "timeout" });
    });
  });
}

/** Free space on the data volume, so it's visible before writes start failing. */
async function diskStatus(): Promise<ServiceStatus> {
  try {
    const s = await statfs("/app/data");
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const usedPct = total > 0 ? Math.round((1 - free / total) * 100) : 0;
    const freeGb = (free / 1e9).toFixed(1);
    return {
      name: "Disk",
      group: SYSTEM,
      state: usedPct >= 90 ? "down" : "up",
      detail: `${usedPct}% used, ${freeGb} GB free`,
    };
  } catch (err) {
    return { name: "Disk", group: SYSTEM, state: "down", detail: err instanceof Error ? err.message : "unreadable" };
  }
}

/** SQLite database size. Not a health failure by itself; a growth signal. */
async function databaseStatus(): Promise<ServiceStatus> {
  const path = (process.env.DATABASE_URL ?? "").replace(/^file:/, "");
  if (!path) return { name: "Database", group: SYSTEM, state: "unconfigured", detail: "No DATABASE_URL" };
  try {
    const s = await stat(path);
    const mb = (s.size / 1e6).toFixed(1);
    return { name: "Database", group: SYSTEM, state: "up", detail: `SQLite, ${mb} MB` };
  } catch (err) {
    return { name: "Database", group: SYSTEM, state: "down", detail: err instanceof Error ? err.message : "unreadable" };
  }
}

/** Email alerting wiring -- presence only; a live send would spam a real topic. */
/**
 * VPN egress for the tour watcher: is its traffic actually leaving through the
 * proxy, or from this box? Reuses the same live two-request check the Tour
 * watch panel's button runs, so the passive row and the button agree.
 *
 * "leaking" is the one that must read as down: the proxy is configured but not
 * carrying traffic, so requests exit from this server's real IP -- the silent
 * failure the whole egress design exists to prevent.
 */
async function egressStatus(): Promise<ServiceStatus> {
  const e = await checkEgress();
  switch (e.state) {
    case "direct":
      return { name: "VPN egress", group: SYSTEM, state: "unconfigured", detail: "Direct (no proxy)" };
    case "protected":
      return { name: "VPN egress", group: SYSTEM, state: "up", detail: `exits via ${e.exitIp}` };
    case "leaking":
      return { name: "VPN egress", group: SYSTEM, state: "down", detail: `leaking — exits from ${e.ip}` };
    case "down":
      return { name: "VPN egress", group: SYSTEM, state: "down", detail: `proxy unreachable (${e.error})` };
  }
}

function alertingStatus(): ServiceStatus {
  return isNotifyConfigured()
    ? { name: "Alerting", group: SYSTEM, state: "up", detail: `SNS, project "${process.env.ALERT_PROJECT ?? "streamy"}"` }
    : { name: "Alerting", group: SYSTEM, state: "unconfigured", detail: "No ALERT_SNS_TOPIC_ARN" };
}

/** Aggregate tour-watch health: enabled pages, any failing, last successful check. */
async function tourWatchStatus(): Promise<ServiceStatus> {
  try {
    const pages = await prisma.watchedPage.findMany({
      where: { enabled: true },
      select: { lastStatus: true, lastCheckedAt: true },
    });
    if (pages.length === 0) {
      return { name: "Tour watch", group: SYSTEM, state: "unconfigured", detail: "No pages watched" };
    }
    const failing = pages.filter((p) => p.lastStatus === "error").length;
    const newest = pages.reduce<Date | null>(
      (acc, p) => (p.lastCheckedAt && (!acc || p.lastCheckedAt > acc) ? p.lastCheckedAt : acc),
      null
    );
    const last = newest ? `${Math.floor((Date.now() - newest.getTime()) / 3_600_000)}h ago` : "never";
    return {
      name: "Tour watch",
      group: SYSTEM,
      state: failing > 0 ? "down" : "up",
      detail: failing > 0 ? `${failing}/${pages.length} failing, last ${last}` : `${pages.length} watched, last ${last}`,
    };
  } catch {
    return { name: "Tour watch", group: SYSTEM, state: "down", detail: "check failed" };
  }
}

export async function getServiceStatuses(): Promise<ServiceStatus[]> {
  const [
    radarr,
    sonarr,
    prowlarr,
    jellyfin,
    downloads,
    ollama,
    searxng,
    geoip,
    blogToken,
    tls,
    disk,
    database,
    tourWatch,
    egress,
  ] = await Promise.all([
    servarrStatus("Radarr", "Media", env("RADARR_URL"), process.env.RADARR_API_KEY ?? "", isRadarrConfigured()),
    servarrStatus("Sonarr", "Media", env("SONARR_URL"), process.env.SONARR_API_KEY ?? "", isSonarrConfigured()),
    servarrStatus(
      "Prowlarr",
      "Downloads",
      env("PROWLARR_URL"),
      process.env.PROWLARR_API_KEY ?? "",
      !!env("PROWLARR_URL") && !!process.env.PROWLARR_API_KEY,
      "v1"
    ),
    jellyfinStatus(),
    qbittorrentStatus(),
    ollamaServiceStatus(),
    searxngStatus(),
    geoipStatus(),
    blogTokenStatus(),
    tlsCertStatus(),
    diskStatus(),
    databaseStatus(),
    tourWatchStatus(),
    egressStatus(),
  ]);

  return [
    jellyfin,
    radarr,
    sonarr,
    ...downloads,
    prowlarr,
    ollama,
    searxng,
    // System group, in rough order of "how loudly does this failing matter".
    disk,
    tls,
    database,
    blogToken,
    geoip,
    tourWatch,
    egress,
    alertingStatus(),
  ];
}
