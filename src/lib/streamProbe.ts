/**
 * Client for mediabox's stream probe (mediabox-infra scripts/stream-probe.py),
 * which pulls a few seconds of one Dispatcharr stream through the VPN and says
 * whether it carries video. See streamVerifyRules.ts for why.
 *
 * Optional: with STREAM_PROBE_URL / STREAM_PROBE_TOKEN unset the game page
 * offers candidates unchecked, as it did before.
 */
import { normalizeProbe, type ProbeResult } from "./streamVerifyRules";

// The service runs one probe at a time and makes a request wait up to 30s for
// another's to finish, then ~10-20s for its own.
const TIMEOUT_MS = 70_000;

function cfg(): { base: string; token: string } | null {
  const base = process.env.STREAM_PROBE_URL?.replace(/\/$/, "");
  const token = process.env.STREAM_PROBE_TOKEN;
  return base && token ? { base, token } : null;
}

export function isStreamProbeConfigured(): boolean {
  return cfg() !== null;
}

/** Probes one stream. Never throws: an unreachable probe is an "error" result. */
export async function probeStream(streamId: number): Promise<ProbeResult> {
  const c = cfg();
  if (!c) return { status: "error", reason: "the stream probe is not configured" };
  try {
    const res = await fetch(`${c.base}/probe?streamId=${encodeURIComponent(String(streamId))}`, {
      headers: { Authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { status: "error", reason: `stream probe returned HTTP ${res.status}` };
    return normalizeProbe(await res.json());
  } catch {
    return { status: "error", reason: "could not reach the stream probe on mediabox" };
  }
}
