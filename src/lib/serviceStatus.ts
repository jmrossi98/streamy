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

const PROBE_TIMEOUT_MS = 5_000;

export type ServiceState = "up" | "down" | "unconfigured";

export type ServiceStatus = {
  name: string;
  /** Grouping for the panel: what this service is for. */
  group: "Media" | "Downloads" | "Assistant";
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

export async function getServiceStatuses(): Promise<ServiceStatus[]> {
  const [radarr, sonarr, prowlarr, jellyfin, downloads, ollama, searxng] = await Promise.all([
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
  ]);

  return [jellyfin, radarr, sonarr, ...downloads, prowlarr, ollama, searxng];
}
