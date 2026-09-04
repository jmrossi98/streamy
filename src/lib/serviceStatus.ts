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

import { isRadarrConfigured, getRadarrHealthIssues, getRadarrStuckImports } from "./radarr";
import { isSonarrConfigured, getSonarrHealthIssues, getSonarrStuckImports } from "./sonarr";
import {
  isJellyfinConfigured,
  getJellyfinLibraryScanStatus,
  getJellyfinActiveTranscodeCount,
} from "./jellyfin";
import { isQbittorrentConfigured } from "./qbittorrent";
import { isGamarrConfigured } from "./gamarr";
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

// "unknown" is distinct from "down": down means we verified a failure,
// unknown means the check itself couldn't run (e.g. we can't authenticate to
// qBittorrent) so we genuinely don't know the thing it would tell us. Reporting
// unknown as down is a false alarm -- a stale password looks identical to a
// compromised VPN if both just say "down".
export type ServiceState = "up" | "down" | "unconfigured" | "unknown";

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
 * One fetch, with a single retry on a network-level failure (timeout, DNS,
 * connection refused). A clean HTTP error response is not retried -- if the
 * password is wrong the tenth attempt fails exactly like the first, so
 * retrying just delays an already-known answer. This is what "resilient"
 * means here: absorb a transient blip (the box waking up, a momentary drop),
 * not paper over a real failure.
 */
async function fetchResilient(url: string, init: RequestInit): Promise<Response | { networkError: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 750));
        continue;
      }
      return { networkError: detail };
    }
  }
  return { networkError: "unreachable" };
}

/**
 * qBittorrent plus the VPN check that matters most: torrent traffic must not
 * leave from the home connection. Reported together because a torrent client
 * that is up but unprotected is worse than one that is down.
 *
 * VPN is reported "unknown" (not "down") whenever qBittorrent itself can't be
 * reached or authenticated -- a stale QBITTORRENT_PASSWORD (which has nothing
 * to do with the tunnel) used to render identically to an actually-leaking
 * VPN, both as a red "Down". They are not the same failure and do not deserve
 * the same alarm.
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
  const login = await fetchResilient(`${base}/api/v2/auth/login`, {
    method: "POST",
    headers: { Referer: base, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: process.env.QBITTORRENT_USER ?? "",
      password: process.env.QBITTORRENT_PASSWORD ?? "",
    }).toString(),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  if ("networkError" in login) {
    return [
      { name: "qBittorrent", group, state: "down", detail: `unreachable — ${login.networkError}` },
      { name: "VPN", group, state: "unknown", detail: "qBittorrent unreachable, can't verify" },
    ];
  }

  const cookie = login.headers.get("set-cookie")?.match(/(QBT_SID[^=]*=[^;]+)/)?.[1];
  if (!login.ok || !cookie) {
    return [
      {
        name: "qBittorrent",
        group,
        state: "down",
        detail: `auth rejected (HTTP ${login.status}) — check QBITTORRENT_PASSWORD`,
      },
      { name: "VPN", group, state: "unknown", detail: "qBittorrent auth failed, can't verify" },
    ];
  }

  try {
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
      vpn = { name: "VPN", group, state: "unknown", detail: "No external address reported yet" };
    } else {
      // Compared against this host's own public IP. Equal means the tunnel is
      // not carrying torrent traffic -- this is the one case that's a real,
      // verified failure, so it stays "down".
      const direct = await probe("https://api.ipify.org?format=json");
      const hostIp = (direct.json as { ip?: string } | undefined)?.ip;
      vpn = !hostIp
        ? { name: "VPN", group, state: "unknown", detail: "Couldn't determine this host's own IP" }
        : torrentIp === hostIp
          ? { name: "VPN", group, state: "down", detail: `Torrents leaving from ${hostIp} — NOT protected` }
          : { name: "VPN", group, state: "up", detail: `Torrents exit via ${torrentIp}` };
    }

    return [client, vpn];
  } catch (err) {
    // Authenticated fine, but the follow-up call failed -- a real qBittorrent
    // problem (we successfully logged in and it's still not answering), but
    // still tells us nothing about the tunnel.
    const detail = err instanceof Error ? err.message : String(err);
    return [
      { name: "qBittorrent", group, state: "down", detail: `authenticated, but ${detail}` },
      { name: "VPN", group, state: "unknown", detail: "qBittorrent unreachable, can't verify" },
    ];
  }
}

/**
 * Radarr's/Sonarr's own self-reported integration health -- indexers,
 * download clients, import paths. This is the layer that catches a stale
 * download-client password: Streamy's own probe of Radarr/Sonarr (servarrStatus,
 * above) only confirms Streamy can reach *them*, which says nothing about
 * whether *they* can reach qBittorrent. That gap is exactly how a password
 * reset on qBittorrent silently broke every download for both apps while
 * every other check kept reporting green.
 */
async function arrIntegrationStatus(
  name: "Radarr" | "Sonarr",
  configured: boolean,
  getIssues: () => Promise<{ source: string; message: string; type: "error" | "warning" }[]>,
  // Titles sitting on a Manual Import confirmation the app couldn't safely
  // resolve itself (see getRadarrStuckImports) -- a different class of thing
  // from a health-check error/warning (which are usually persistent config
  // problems), so it's appended to whatever detail is already being shown
  // rather than treated as its own error tier.
  getStuckImports: () => Promise<string[]>
): Promise<ServiceStatus> {
  const group = "Downloads" as const;
  const label = `${name} integrations`;
  if (!configured) {
    return { name: label, group, state: "unconfigured", detail: "Not configured" };
  }
  const [issues, stuckImports] = await Promise.all([getIssues(), getStuckImports()]);
  const stuckDetail =
    stuckImports.length > 0
      ? `${stuckImports.length} title${stuckImports.length > 1 ? "s" : ""} need${
          stuckImports.length > 1 ? "" : "s"
        } Manual Import in ${name}: ${stuckImports.join(", ")}`
      : null;

  const errors = issues.filter((i) => i.type === "error");
  if (errors.length > 0) {
    const detail = [errors.map((i) => i.message).join("; "), stuckDetail].filter(Boolean).join(" — ");
    return { name: label, group, state: "down", detail };
  }
  const warnings = issues.filter((i) => i.type === "warning");
  const warningDetail = warnings.length > 0 ? warnings.map((i) => i.message).join("; ") : null;
  const combined = [warningDetail, stuckDetail].filter(Boolean).join(" — ");
  return { name: label, group, state: "up", detail: combined || "healthy" };
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

// The "Scan Media Library" task's own IntervalTrigger is 12h (confirmed live
// against /ScheduledTasks); requestJellyfinLibraryScan also fires extra ad-hoc
// runs on top of that whenever a title comes up missing, so in practice a
// healthy setup scans far more often than this. Generous grace on top of the
// scheduled interval before calling it stale, so this doesn't flag red for a
// perfectly normal gap between scheduled runs.
const LIBRARY_SCAN_STALE_MS = 16 * 60 * 60 * 1000;

/** Catches "Radarr/Sonarr say it's downloaded, but Jellyfin hasn't scanned it in yet" before a viewer does. */
async function libraryScanStatus(): Promise<ServiceStatus> {
  const name = "Library scan";
  if (!isJellyfinConfigured()) return { name, group: SYSTEM, state: "unconfigured", detail: "Jellyfin not configured" };
  const result = await getJellyfinLibraryScanStatus();
  if (!result) return { name, group: SYSTEM, state: "unknown", detail: "couldn't reach Jellyfin" };
  if (result.running) return { name, group: SYSTEM, state: "up", detail: "scanning now" };
  if (!result.lastCompletedAt) return { name, group: SYSTEM, state: "unknown", detail: "never completed" };
  const ageMs = Date.now() - result.lastCompletedAt.getTime();
  const ageHrs = (ageMs / 3_600_000).toFixed(1);
  return {
    name,
    group: SYSTEM,
    state: ageMs > LIBRARY_SCAN_STALE_MS ? "down" : "up",
    detail: `last completed ${ageHrs}h ago`,
  };
}

/**
 * Active transcode count, as a proxy for whether the mediabox's one GPU
 * (1050 Ti) is what's making playback feel slow right now, rather than a
 * per-title bug. Purely informational (always "up" when the count itself
 * was readable) -- the card's real concurrent-NVENC-session ceiling isn't
 * verified for this specific driver/setup, so asserting a "down" threshold
 * here would be a guess dressed up as a health verdict.
 */
async function transcodeLoadStatus(): Promise<ServiceStatus> {
  const name = "Transcode load";
  if (!isJellyfinConfigured()) return { name, group: SYSTEM, state: "unconfigured", detail: "Jellyfin not configured" };
  const count = await getJellyfinActiveTranscodeCount();
  if (count == null) return { name, group: SYSTEM, state: "unknown", detail: "couldn't reach Jellyfin" };
  return {
    name,
    group: SYSTEM,
    state: "up",
    detail: count === 0 ? "idle" : `${count} active transcode${count === 1 ? "" : "s"}`,
  };
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

// Litestream ships a snapshot at most every 24h (litestream.yml's own
// snapshot-interval) plus near-continuous WAL segments in between. A quiet
// site can legitimately go a while with no *new* WAL segment (no writes
// happened), so this deliberately doesn't treat "no recent object" as
// failure on its own -- only past the daily-snapshot cadence plus grace,
// which means even the scheduled snapshot itself failed to land.
const BACKUP_STALE_MS = 26 * 60 * 60 * 1000;

/**
 * Freshness of the Litestream → S3 backup, by the most recently modified
 * object in the bucket -- not Litestream's own metrics (0.3 doesn't expose a
 * metrics port in this deployment, and there's no other way to reach the
 * sidecar container from here), and not guessing at its internal S3 key
 * layout (generations/segments/snapshots) beyond "some object under this
 * bucket got written recently". Read-only ListObjectsV2 against the same
 * bucket + credentials Litestream itself already writes with -- see
 * litestream.yml.
 */
async function backupStatus(): Promise<ServiceStatus> {
  const name = "Backup (Litestream)";
  const bucket = process.env.LITESTREAM_BUCKET;
  const accessKeyId = process.env.LITESTREAM_ACCESS_KEY_ID;
  const secretAccessKey = process.env.LITESTREAM_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    return { name, group: SYSTEM, state: "unconfigured", detail: "No LITESTREAM_* set" };
  }
  try {
    // Imported lazily, matching notify.ts's SNS client: the SDK is only
    // needed when the backup itself is actually configured.
    const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
    });
    let newest: Date | null = null;
    let token: string | undefined;
    // Small bucket ("well under a megabyte" per litestream.yml), but paginate
    // anyway rather than assume it stays that way -- the newest object could
    // be on any page depending on S3's listing order.
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 })
      );
      for (const obj of page.Contents ?? []) {
        if (obj.LastModified && (!newest || obj.LastModified > newest)) newest = obj.LastModified;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    if (!newest) return { name, group: SYSTEM, state: "down", detail: "bucket is empty" };
    const ageMs = Date.now() - newest.getTime();
    const ageHrs = (ageMs / 3_600_000).toFixed(1);
    return {
      name,
      group: SYSTEM,
      state: ageMs > BACKUP_STALE_MS ? "down" : "up",
      detail: `newest object ${ageHrs}h ago`,
    };
  } catch (err) {
    return { name, group: SYSTEM, state: "unknown", detail: err instanceof Error ? err.message : "check failed" };
  }
}

/**
 * Month-to-date AWS spend against a fixed dollar ceiling, via Cost Explorer.
 * No baked-in default threshold -- this account's actual expected spend
 * isn't something to guess at, so the check stays "unconfigured" (not a
 * false "down") until AWS_COST_ALERT_THRESHOLD_USD is set deliberately.
 *
 * Needs its own IAM permission: ce:GetCostAndUsage, which the existing
 * alerting credential (secrets.ALERT_AWS_ACCESS_KEY_ID/SECRET, written into
 * the container's real env as AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY --
 * see deploy.yml -- and scoped to sns:Publish only, per .env.example) does
 * NOT have -- add it to that same IAM user's policy rather than minting a
 * new credential pair for one read-only call. Cost Explorer must also be
 * enabled once for the account (AWS Console -> Billing -> Cost Explorer)
 * before this API answers at all; unconfigured/unknown either way until
 * both are done, never a false failure.
 */
async function awsCostStatus(): Promise<ServiceStatus> {
  const name = "AWS spend";
  const thresholdStr = process.env.AWS_COST_ALERT_THRESHOLD_USD;
  const threshold = thresholdStr ? Number(thresholdStr) : NaN;
  if (!thresholdStr || Number.isNaN(threshold)) {
    return { name, group: SYSTEM, state: "unconfigured", detail: "No AWS_COST_ALERT_THRESHOLD_USD set" };
  }
  const accessKeyId = process.env.ALERT_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ALERT_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return { name, group: SYSTEM, state: "unconfigured", detail: "No AWS credentials available" };
  }
  try {
    // Imported lazily, matching notify.ts's SNS client.
    const { CostExplorerClient, GetCostAndUsageCommand } = await import("@aws-sdk/client-cost-explorer");
    // Cost Explorer is us-east-1 only, regardless of where the resources
    // themselves live -- it's a billing-account-wide, not per-region, API.
    const client = new CostExplorerClient({ region: "us-east-1", credentials: { accessKeyId, secretAccessKey } });
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const tomorrow = new Date(now.getTime() + 24 * 3_600_000);
    // TimePeriod.End must be strictly after Start and is exclusive -- a
    // Start=End=today request (asking for "today alone") is rejected by the
    // API, confirmed against Cost Explorer's own documented constraints.
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const result = await client.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: iso(startOfMonth), End: iso(tomorrow) },
        Granularity: "MONTHLY",
        Metrics: ["UnblendedCost"],
      })
    );
    const mtd = result.ResultsByTime?.reduce(
      (sum, r) => sum + Number(r.Total?.UnblendedCost?.Amount ?? 0),
      0
    );
    if (mtd == null || Number.isNaN(mtd)) {
      return { name, group: SYSTEM, state: "unknown", detail: "no cost data returned" };
    }
    return {
      name,
      group: SYSTEM,
      state: mtd > threshold ? "down" : "up",
      detail: `$${mtd.toFixed(2)} MTD (ceiling $${threshold.toFixed(2)})`,
    };
  } catch (err) {
    return { name, group: SYSTEM, state: "unknown", detail: err instanceof Error ? err.message : "check failed" };
  }
}

// Sent whenever set; gamarr accepts unauthenticated calls until its own
// AUTH_USERNAME/PASSWORD or API_KEY is configured, but once any of those
// exist it locks its *entire* API, not just its web UI (confirmed live,
// 2026-09-04 -- every one of these probes went from open to a flat 401 the
// moment mediabox's gamarr got an API_KEY, before this line existed here).
const gamarrHeaders = (): Record<string, string> =>
  process.env.GAMARR_API_KEY ? { "X-Api-Key": process.env.GAMARR_API_KEY } : {};

/** Basic reachability -- gamarr's own /api/health. */
async function gamarrStatus(): Promise<ServiceStatus> {
  const group = "Downloads" as const;
  if (!isGamarrConfigured()) {
    return { name: "gamarr", group, state: "unconfigured", detail: "Not configured" };
  }
  const res = await probe(`${env("GAMARR_URL")}/api/health`, gamarrHeaders());
  if (!res.ok) {
    return { name: "gamarr", group, state: "down", detail: res.error ?? `HTTP ${res.status}` };
  }
  const version = (res.json as { version?: string } | undefined)?.version;
  return { name: "gamarr", group, state: "up", detail: version ? `v${version}` : "reachable" };
}

/**
 * gamarr's self-reported health for its own configured sources (Prowlarr,
 * Myrient, Vimm's) -- same spirit as arrIntegrationStatus above (Radarr's
 * own health check can see things Streamy's mere reachability probe can't,
 * like one indexer's circuit breaker having tripped). /api/sources/health
 * returns `{ sources: {} }` when nothing has tripped; entries only appear
 * once something has -- the endpoint reports problems, not a full roster, so
 * an empty object is read as "no known issues" rather than "no sources
 * configured" (that distinction already comes from gamarrStatus above).
 */
async function gamarrSourcesStatus(): Promise<ServiceStatus> {
  const group = "Downloads" as const;
  const label = "gamarr sources";
  if (!isGamarrConfigured()) {
    return { name: label, group, state: "unconfigured", detail: "Not configured" };
  }
  const res = await probe(`${env("GAMARR_URL")}/api/sources/health`, gamarrHeaders());
  if (!res.ok) {
    return { name: label, group, state: "unknown", detail: res.error ?? `HTTP ${res.status}` };
  }
  const sources = (res.json as { sources?: Record<string, unknown> } | undefined)?.sources ?? {};
  const names = Object.keys(sources);
  if (names.length === 0) {
    return { name: label, group, state: "up", detail: "all sources healthy" };
  }
  return {
    name: label,
    group,
    state: "down",
    detail: `${names.length} source${names.length > 1 ? "s" : ""} degraded: ${names.join(", ")}`,
  };
}

export async function getServiceStatuses(): Promise<ServiceStatus[]> {
  const [
    radarr,
    sonarr,
    prowlarr,
    gamarr,
    gamarrSources,
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
    radarrIntegrations,
    sonarrIntegrations,
    libraryScan,
    transcodeLoad,
    backup,
    awsCost,
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
    gamarrStatus(),
    gamarrSourcesStatus(),
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
    arrIntegrationStatus("Radarr", isRadarrConfigured(), getRadarrHealthIssues, getRadarrStuckImports),
    arrIntegrationStatus("Sonarr", isSonarrConfigured(), getSonarrHealthIssues, getSonarrStuckImports),
    libraryScanStatus(),
    transcodeLoadStatus(),
    backupStatus(),
    awsCostStatus(),
  ]);

  return [
    jellyfin,
    radarr,
    sonarr,
    ...downloads,
    radarrIntegrations,
    sonarrIntegrations,
    prowlarr,
    gamarr,
    gamarrSources,
    ollama,
    searxng,
    // System group, in rough order of "how loudly does this failing matter".
    disk,
    tls,
    database,
    backup,
    awsCost,
    libraryScan,
    transcodeLoad,
    blogToken,
    geoip,
    tourWatch,
    egress,
    alertingStatus(),
  ];
}
