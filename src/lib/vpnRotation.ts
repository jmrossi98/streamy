/**
 * Last VPN exit-IP rotation on mediabox, read from a JSON snapshot vpn-
 * failover.py writes only when it actually rotates.
 *
 * Same reasoning and the same served-by as diskUsage.ts: physically the
 * flash container's nginx, reused rather than a second env var or a second
 * read-only file server for one more small status file.
 */

const PROBE_TIMEOUT_MS = 6_000;

export type VpnRotation = {
  currentRegion: string;
  lastRotationUtc: string;
  reason: string;
};

function baseUrl(): string {
  return process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "") ?? "";
}

export function isVpnRotationConfigured(): boolean {
  return !!baseUrl();
}

/**
 * "never" is a real, good answer -- no rotation has happened, so the exit IP
 * has been stable -- and deliberately not collapsed into null the way an
 * actual failure to check is. vpn-failover.py never writes this file until
 * its first real rotation, which the nginx side of this reports as a plain
 * 404 (see config/flash/nginx.conf) -- indistinguishable from "unreachable"
 * by status code alone, so that distinction is made here, not left for the
 * caller to guess at from a bare null.
 */
export async function getLastVpnRotation(): Promise<VpnRotation | "never" | null> {
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/status/vpn-failover-state.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 404) return "never";
    if (!res.ok) return null;
    const body = (await res.json()) as {
      current_region?: string;
      last_rotation?: string;
      last_rotation_reason?: string;
    } | null;
    if (!body?.current_region || !body?.last_rotation) return null;
    return {
      currentRegion: body.current_region,
      lastRotationUtc: body.last_rotation,
      reason: body.last_rotation_reason ?? "",
    };
  } catch {
    return null;
  }
}
