/**
 * The exit-node client history turned into what the Streaming tab shows: who
 * is connected and how, each device's throughput over the day, and every time
 * a device's path changed.
 *
 * Pure. The shape it is built to catch: "the exit node is slow on my phone"
 * has been CPU starvation (2026-10-16), a resolver resetting every third
 * lookup (2026-10-20) and a LAN path that expired and fell back to DERP
 * (2026-10-20) -- three faults, one symptom, each diagnosed afterwards from
 * counters nobody was watching. A dip in a device's line in the same minute
 * its path flips to DERP is the picture of the third; a dip with the path
 * still direct points at the box or the tunnel instead.
 */

import type { ExitClientPoint, ExitNodeClientsHistory, ExitNodeInfo } from "./exitNodeClients";

/** Older than this and the sampler has stopped, or the box is off. */
export const STALE_AFTER_S = 180;

/**
 * Intervals longer than this many sampling periods are holes, not readings.
 * Same rule as the metrics history: averaging a delta across an outage draws
 * a smooth trickle where the truth is "unknown".
 */
const MAX_GAP_MULTIPLE = 3;

/** The chart has five validated colours; more series than that would cycle. */
export const MAX_CHART_SERIES = 5;

export type ClientSeries = {
  device: string;
  node: string;
  label: string;
  /** Mbit/s to the device (the exit node's Tx), one per time, null = no reading. */
  down: (number | null)[];
  /** Mbit/s from the device (the exit node's Rx). */
  up: (number | null)[];
  /** The path at the end of each interval. */
  paths: (string | null)[];
  totalBytes: number;
};

export type PathEvent = {
  t: string;
  device: string;
  node: string;
  from: string | null;
  to: string | null;
};

export type ClientNow = {
  device: string;
  node: string;
  nodeLabel: string;
  os: string | null;
  active: boolean;
  path: string | null;
  endpoint: string | null;
  lastHandshake: string | null;
  downMbps: number | null;
  upMbps: number | null;
  derpMinutesLastHour: number;
  pathChangesLastHour: number;
};

export type ExitNodeClientsView = {
  configured: boolean;
  generatedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  nodes: ExitNodeInfo[];
  clients: ClientNow[];
  events: PathEvent[];
  /** Interval end times, shared by every series. */
  times: string[];
  series: ClientSeries[];
};

type Entry = { p: string | null; rx: number; tx: number };

/** "US" / "Toronto" out of the role the sampler records, else the node name. */
export function nodeLabel(node: string, nodes: ExitNodeInfo[]): string {
  const role = nodes.find((n) => n.name === node)?.role ?? "";
  const m = /\(([^)]+)\)/.exec(role);
  return m ? m[1] : node;
}

/** "direct" | "peer relay" | "DERP nyc" | "idle". */
export function pathLabel(path: string | null): string {
  if (!path) return "idle";
  if (path === "peer-relay") return "peer relay";
  if (path.startsWith("derp:")) return `DERP ${path.slice(5)}`;
  return path;
}

export function isDerp(path: string | null | undefined): boolean {
  return typeof path === "string" && path.startsWith("derp:");
}

function entry(point: ExitClientPoint | undefined, node: string, device: string): Entry | undefined {
  return point?.nodes?.[node]?.[device];
}

/**
 * Mbit/s each way between two samples, or null when the interval means
 * nothing: a missing side, no time passed, too long a gap, or a counter that
 * went backwards (tailscaled restarted with its tunnel).
 */
function ratesBetween(
  prev: Entry | undefined,
  cur: Entry | undefined,
  elapsedS: number,
  maxGapS: number
): { down: number; up: number; bytes: number } | null {
  if (!prev || !cur || elapsedS <= 0 || elapsedS > maxGapS) return null;
  const dTx = cur.tx - prev.tx;
  const dRx = cur.rx - prev.rx;
  if (dTx < 0 || dRx < 0) return null;
  const mbps = (bytes: number) => (bytes * 8) / 1_000_000 / elapsedS;
  return { down: mbps(dTx), up: mbps(dRx), bytes: dTx + dRx };
}

function elapsedSeconds(a: ExitClientPoint, b: ExitClientPoint): number {
  const am = Date.parse(a.t);
  const bm = Date.parse(b.t);
  if (!Number.isFinite(am) || !Number.isFinite(bm)) return 0;
  return (bm - am) / 1000;
}

/** Every (node, device) pair in the window, in first-seen order. */
function clientKeys(points: ExitClientPoint[]): { node: string; device: string }[] {
  const seen = new Set<string>();
  const keys: { node: string; device: string }[] = [];
  for (const p of points) {
    for (const [node, devices] of Object.entries(p.nodes ?? {})) {
      for (const device of Object.keys(devices ?? {})) {
        const k = `${node}\u0000${device}`;
        if (seen.has(k)) continue;
        seen.add(k);
        keys.push({ node, device });
      }
    }
  }
  return keys;
}

/**
 * One aligned series per device-and-node that moved any bytes in the window,
 * busiest first. Times are the interval ends, so index i covers
 * points[i] .. points[i+1].
 */
export function deriveClientSeries(history: ExitNodeClientsHistory): { times: string[]; series: ClientSeries[] } {
  const points = history.points ?? [];
  const times = points.slice(1).map((p) => p.t);
  const maxGapS = history.intervalSeconds * MAX_GAP_MULTIPLE;
  const series: ClientSeries[] = [];

  for (const { node, device } of clientKeys(points)) {
    const down: (number | null)[] = [];
    const up: (number | null)[] = [];
    const paths: (string | null)[] = [];
    let totalBytes = 0;
    for (let i = 1; i < points.length; i++) {
      const cur = entry(points[i], node, device);
      const r = ratesBetween(entry(points[i - 1], node, device), cur, elapsedSeconds(points[i - 1], points[i]), maxGapS);
      down.push(r ? r.down : null);
      up.push(r ? r.up : null);
      paths.push(cur?.p ?? null);
      if (r) totalBytes += r.bytes;
    }
    if (totalBytes <= 0) continue;
    series.push({ device, node, label: `${device} · ${nodeLabel(node, history.nodes)}`, down, up, paths, totalBytes });
  }

  series.sort((a, b) => b.totalBytes - a.totalBytes || a.device.localeCompare(b.device));
  return { times, series };
}

/**
 * Every change of path between consecutive samples, newest first. A device
 * appearing (null -> direct) and disappearing (direct -> null) count: the
 * second is what a dropped session looks like from here.
 */
export function pathEvents(history: ExitNodeClientsHistory): PathEvent[] {
  const points = history.points ?? [];
  const out: PathEvent[] = [];
  for (const { node, device } of clientKeys(points)) {
    for (let i = 1; i < points.length; i++) {
      const from = entry(points[i - 1], node, device)?.p ?? null;
      const to = entry(points[i], node, device)?.p ?? null;
      if (from !== to) out.push({ t: points[i].t, device, node, from, to });
    }
  }
  out.sort((a, b) => Date.parse(b.t) - Date.parse(a.t) || a.device.localeCompare(b.device));
  return out;
}

/**
 * The devices as they are right now, one row per device and node it is
 * actually using. A device idle on every node still gets one row (on the
 * first node that lists it) so it is visibly connected-but-idle rather than
 * missing.
 */
export function clientsNow(history: ExitNodeClientsHistory, nowMs: number, events: PathEvent[]): ClientNow[] {
  const points = history.points ?? [];
  const last = points.at(-1);
  const prev = points.at(-2);
  const elapsedS = last && prev ? elapsedSeconds(prev, last) : 0;
  const maxGapS = history.intervalSeconds * MAX_GAP_MULTIPLE;
  const hourAgoMs = nowMs - 3_600_000;

  const rows: ClientNow[] = [];
  const seenDevices = new Set<string>();
  const idleCandidates: ClientNow[] = [];

  for (const [node, devices] of Object.entries(history.now ?? {})) {
    for (const [device, c] of Object.entries(devices ?? {})) {
      const r = ratesBetween(entry(prev, node, device), entry(last, node, device), elapsedS, maxGapS);
      const row: ClientNow = {
        device,
        node,
        nodeLabel: nodeLabel(node, history.nodes),
        os: c.os ?? null,
        active: Boolean(c.active),
        path: c.path ?? null,
        endpoint: c.endpoint ?? null,
        lastHandshake: c.lastHandshake ?? null,
        downMbps: r ? r.down : null,
        upMbps: r ? r.up : null,
        derpMinutesLastHour: points.filter((p) => Date.parse(p.t) >= hourAgoMs && isDerp(entry(p, node, device)?.p)).length,
        pathChangesLastHour: events.filter((e) => e.node === node && e.device === device && Date.parse(e.t) >= hourAgoMs).length,
      };
      if (row.active || c.rxBytes > 0 || c.txBytes > 0) {
        rows.push(row);
        seenDevices.add(device);
      } else {
        idleCandidates.push(row);
      }
    }
  }
  for (const row of idleCandidates) {
    if (seenDevices.has(row.device)) continue;
    seenDevices.add(row.device);
    rows.push(row);
  }

  rows.sort((a, b) => Number(b.active) - Number(a.active) || a.device.localeCompare(b.device) || a.node.localeCompare(b.node));
  return rows;
}

export function buildView(history: ExitNodeClientsHistory | null, nowMs: number, configured: boolean): ExitNodeClientsView {
  if (!history) {
    return { configured, generatedAt: null, ageSeconds: null, stale: false, nodes: [], clients: [], events: [], times: [], series: [] };
  }
  const generatedMs = Date.parse(history.generatedAt);
  const ageSeconds = Number.isFinite(generatedMs) ? Math.max(0, Math.round((nowMs - generatedMs) / 1000)) : null;
  const events = pathEvents(history);
  const { times, series } = deriveClientSeries(history);
  return {
    configured,
    generatedAt: history.generatedAt,
    ageSeconds,
    stale: ageSeconds === null || ageSeconds > STALE_AFTER_S,
    nodes: history.nodes ?? [],
    clients: clientsNow(history, nowMs, events),
    events,
    times,
    series,
  };
}
