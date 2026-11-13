/**
 * When mediabox is off, fail fast instead of waiting it out (2026-11-13).
 *
 * Every backend Streamy uses -- Jellyfin, Sonarr, Radarr, SABnzbd, qBittorrent,
 * Dispatcharr, the status files -- lives on one machine at home, reached over
 * the tailnet. When that machine is off, a fetch to it doesn't fail: the
 * packets go nowhere and undici gives up after its 10 s connect timeout
 * (measured from the app container: 10,541 ms, UND_ERR_CONNECT_TIMEOUT). A
 * page that asks mediabox three things in a row then takes half a minute, and
 * a phone gives up on it first -- which reads as "Streamy is down", though
 * nothing on Lightsail is.
 *
 * So the server keeps a breaker per homelab host: a background TCP probe, and
 * the connect failures real requests hit, decide whether the host is up; while
 * it is down, requests to it fail at once with the same error a network
 * failure gives, and every page falls back the way it already does when
 * mediabox can't be read. Pure: homelabBreaker.ts holds the state and sockets.
 */

/** The env vars that point at mediabox services. Their hosts are the homelab. */
export const HOMELAB_URL_KEYS = [
  "JELLYFIN_URL",
  "SONARR_URL",
  "RADARR_URL",
  "PROWLARR_URL",
  "SABNZBD_URL",
  "QBITTORRENT_URL",
  "DISPATCHARR_URL",
  "SPORTARR_URL",
  "STREAM_PROBE_URL",
  "FLASH_LIBRARY_URL",
  "SKILL_RUNNER_URL",
  "SEARXNG_URL",
  "OLLAMA_URL",
  "WEBDAV_URL",
  "GAMARR_URL",
  "DIAG_URL",
  "FLARESOLVERR_URL",
  "PORTAINER_URL",
  "SYNCTHING_URL",
] as const;

export type ProbeTarget = { host: string; port: number };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * One probe target per homelab host: the port of the first service listed for
 * it (Jellyfin first -- always running). A loopback URL is not the homelab.
 */
export function homelabTargets(env: Record<string, string | undefined>): ProbeTarget[] {
  const out = new Map<string, ProbeTarget>();
  for (const key of HOMELAB_URL_KEYS) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    const host = url.hostname.toLowerCase();
    if (!host || LOCAL_HOSTS.has(host) || out.has(host)) continue;
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    out.set(host, { host, port });
  }
  return [...out.values()];
}

/** The hostname a fetch is for, or null when it can't be read (a relative URL). */
export function hostOf(input: unknown): string | null {
  let raw: string | null = null;
  if (typeof input === "string") raw = input;
  else if (input instanceof URL) raw = input.href;
  else if (input && typeof input === "object" && typeof (input as { url?: unknown }).url === "string") {
    raw = (input as { url: string }).url;
  }
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Errors that mean the host itself can't be reached, as opposed to a service
 * on it being down (ECONNREFUSED: the machine answered) or slow (an abort, a
 * headers timeout). Only these open the breaker from a real request.
 */
const UNREACHABLE = new Set(["UND_ERR_CONNECT_TIMEOUT", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ETIMEDOUT"]);

/** The first error code on an error or down its cause chain ("fetch failed" hides it in cause). */
export function errorCode(err: unknown): string | null {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e && typeof e === "object"; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export function isUnreachable(err: unknown): boolean {
  const code = errorCode(err);
  return code !== null && UNREACHABLE.has(code);
}

export type HostState = {
  down: boolean;
  /** When it went down (ms), while down. */
  since: number | null;
  /** Consecutive failed probes. */
  probeFailures: number;
  lastError: string | null;
};

export const HOST_UP: HostState = { down: false, since: null, probeFailures: 0, lastError: null };

/**
 * Two probes in a row, 15 s apart: one lost SYN over the tailnet (a DERP path
 * being re-established) must not cut off a stream's next segment.
 */
export const PROBE_FAILURES_TO_OPEN = 2;
export const PROBE_TIMEOUT_MS = 3_000;
/** Checked less often while up; often while down, so it's back within seconds. */
export const PROBE_EVERY_UP_MS = 15_000;
export const PROBE_EVERY_DOWN_MS = 5_000;

export function onProbe(state: HostState, ok: boolean, now: number, error: string | null = null): HostState {
  if (ok) return HOST_UP;
  const probeFailures = state.probeFailures + 1;
  const down = state.down || probeFailures >= PROBE_FAILURES_TO_OPEN;
  return { down, since: down ? (state.since ?? now) : null, probeFailures, lastError: error };
}

/**
 * A real request waited out a connect timeout (10 s of silence) or got told the
 * host is unreachable: that is enough to open at once.
 */
export function onRequestUnreachable(state: HostState, now: number, error: string | null): HostState {
  return { ...state, down: true, since: state.since ?? now, lastError: error };
}

/**
 * Often while a host is down or one probe has just failed: a first failure is
 * confirmed in 5 s rather than 15, so a page loaded after mediabox goes off
 * waits ~10 s at most for the breaker, not ~20 (measured locally 2026-11-13).
 */
export function probeDelayMs(states: Iterable<HostState>): number {
  for (const s of states) if (s.down || s.probeFailures > 0) return PROBE_EVERY_DOWN_MS;
  return PROBE_EVERY_UP_MS;
}

export type HomelabStatus = { online: boolean; downSince: number | null };

/** Offline if any homelab host is down, since the earliest of them. */
export function summarize(states: Iterable<HostState>): HomelabStatus {
  let downSince: number | null = null;
  for (const s of states) {
    if (s.down) downSince = Math.min(downSince ?? Infinity, s.since ?? Date.now());
  }
  return { online: downSince === null, downSince };
}

/** The banner checks back often while mediabox is down, rarely while it's up. */
export const BANNER_POLL_OFFLINE_MS = 15_000;
export const BANNER_POLL_ONLINE_MS = 60_000;

/** What the site-wide banner says while mediabox is down. */
export function offlineBannerText(downSince: number | null, formatTime?: (ms: number) => string): string {
  const since = downSince !== null && formatTime ? ` since ${formatTime(downSince)}` : "";
  return `The home media server has been offline${since}, so movies, shows and live TV won't play right now. Browsing and My List still work.`;
}
