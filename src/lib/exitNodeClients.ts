/**
 * Who is on each Tailscale exit node, by which path, with a day of per-minute
 * byte counters -- as published by scripts/exit-node-clients.py in
 * mediabox-infra to /data/status/exit-node-clients.json (served by the flash
 * container's nginx like the other status files).
 *
 * The publisher stores RAW tailscaled per-peer counters, not rates, for the
 * same reason metrics-sample.sh does: a counter reset (tailscaled restarting
 * with its tunnel) stays recognisable as a negative delta instead of becoming
 * a spike or a silent zero. exitNodeClientsRules.ts derives the rates.
 *
 * Rewritten once a minute on the box; cached here for ten seconds so an admin
 * tab polling and a second tab don't both cross the tailnet for the same file.
 */

import { cached } from "./ttlCache";

const TIMEOUT_MS = 6_000;
const CACHE_MS = 10_000;

/** A device as one exit node sees it right now. */
export type ExitClientNow = {
  os: string | null;
  /** A live WireGuard session with this node -- the device is using (or just used) it. */
  active: boolean;
  /** "direct" | "peer-relay" | "derp:<region>" while active, null otherwise. */
  path: string | null;
  endpoint: string | null;
  /** From the exit node's side: Rx is what the device sent, Tx what it received. */
  rxBytes: number;
  txBytes: number;
  lastHandshake: string | null;
};

/** One minute's sample: per node, per device, the path and counters. */
export type ExitClientPoint = {
  t: string;
  nodes: Record<string, Record<string, { p: string | null; rx: number; tx: number }>>;
};

export type ExitNodeInfo = {
  name: string;
  container: string;
  role: string;
  readable: boolean;
  backendState?: string;
  error?: string;
};

export type ExitNodeClientsHistory = {
  generatedAt: string;
  intervalSeconds: number;
  nodes: ExitNodeInfo[];
  now: Record<string, Record<string, ExitClientNow>>;
  points: ExitClientPoint[];
};

function baseUrl(): string {
  return process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "") ?? "";
}

export function isExitNodeClientsConfigured(): boolean {
  return Boolean(baseUrl());
}

/** Null when not configured, not yet written (404), unreachable or malformed. */
export async function getExitNodeClients(): Promise<ExitNodeClientsHistory | null> {
  const base = baseUrl();
  if (!base) return null;
  return cached("exit-node-clients", CACHE_MS, async () => {
    try {
      const res = await fetch(`${base}/status/exit-node-clients.json`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<ExitNodeClientsHistory> | null;
      if (!body || typeof body.generatedAt !== "string" || !Array.isArray(body.points)) return null;
      return {
        generatedAt: body.generatedAt,
        intervalSeconds: body.intervalSeconds ?? 60,
        nodes: Array.isArray(body.nodes) ? body.nodes : [],
        now: body.now && typeof body.now === "object" ? body.now : {},
        points: body.points as ExitClientPoint[],
      };
    } catch {
      return null;
    }
  });
}
