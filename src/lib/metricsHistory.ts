/**
 * The rolling 24-hour metrics history mediabox publishes, turned into series
 * a chart can draw.
 *
 * The publisher (mediabox-infra scripts/metrics-sample.sh) records RAW
 * interface counters rather than rates, deliberately: /proc/net/dev gives
 * monotonic byte totals, and storing what was measured means a counter reset
 * stays recoverable. Deriving the rate is this file's job, and it is where
 * the awkward cases live.
 */

const PROBE_TIMEOUT_MS = 6_000;

export type MetricPoint = {
  t: string;
  net: {
    primary: { iface: string; rxBytes: number; txBytes: number };
    tailscale: { iface: string; rxBytes: number; txBytes: number };
  };
  temps: {
    cpu: number | null;
    ambient: number | null;
    /** Null on a box with no NVIDIA GPU, or none the driver can read. */
    gpu?: number | null;
    disks: Record<string, number>;
  };
  /**
   * Intel RAPL energy counters in microjoules, monotonic. Watts are derived
   * from consecutive samples, never stored -- same reasoning as the network
   * byte counters.
   */
  energy?: { packageUj: number | null; dramUj: number | null };
  /** device -> "ssd" | "hdd", read from the kernel's rotational flag. */
  diskKinds?: Record<string, string>;
  mem: { totalBytes: number; availableBytes: number };
  fs: {
    root: { totalBytes: number; freeBytes: number };
    data: { totalBytes: number; freeBytes: number };
  };
};

export type MetricsHistory = {
  generatedAt: string;
  intervalSeconds: number;
  points: MetricPoint[];
};

/** One derived throughput reading, bytes per second over the interval. */
export type ThroughputPoint = {
  t: string;
  primaryDown: number;
  primaryUp: number;
  tailscaleDown: number;
  tailscaleUp: number;
};

export type TempPoint = {
  t: string;
  cpu: number | null;
  ambient: number | null;
  gpu: number | null;
  disks: Record<string, number>;
  diskKinds: Record<string, string>;
};

/** Watts over an interval, derived from RAPL energy counters. */
export type PowerPoint = { t: string; cpuWatts: number | null; dramWatts: number | null };

function baseUrl(): string {
  return process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "") ?? "";
}

export function isMetricsHistoryConfigured(): boolean {
  return !!baseUrl();
}

export async function getMetricsHistory(): Promise<MetricsHistory | null> {
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/status/metrics-24h.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<MetricsHistory> | null;
    if (!body || !Array.isArray(body.points)) return null;
    return {
      generatedAt: body.generatedAt ?? "",
      intervalSeconds: body.intervalSeconds ?? 300,
      points: body.points as MetricPoint[],
    };
  } catch {
    return null;
  }
}

/**
 * How far apart two samples may be before the interval between them stops
 * meaning anything.
 *
 * A gap much longer than the sampling interval means the box was off, or cron
 * did not run. Averaging a counter delta across that gap produces a number
 * that is arithmetically correct and completely misleading -- six hours of
 * downtime followed by one sample reads as a smooth trickle across the whole
 * outage. Those intervals are dropped instead, which leaves a visible hole in
 * the chart. A hole is the honest shape for "we do not know".
 */
const MAX_GAP_MULTIPLE = 3;

/**
 * Bytes per second between consecutive samples.
 *
 * Uses each pair's ACTUAL timestamps rather than the nominal interval: cron
 * drifts, a busy box runs the sampler late, and dividing a real delta by an
 * assumed 300s quietly overstates throughput whenever it does.
 */
export function deriveThroughput(history: MetricsHistory): ThroughputPoint[] {
  const out: ThroughputPoint[] = [];
  const maxGapMs = history.intervalSeconds * MAX_GAP_MULTIPLE * 1000;

  for (let i = 1; i < history.points.length; i++) {
    const prev = history.points[i - 1];
    const cur = history.points[i];

    const prevMs = Date.parse(prev.t);
    const curMs = Date.parse(cur.t);
    if (!Number.isFinite(prevMs) || !Number.isFinite(curMs)) continue;

    const elapsedS = (curMs - prevMs) / 1000;
    if (elapsedS <= 0) continue;
    if (curMs - prevMs > maxGapMs) continue;

    // A negative delta is a counter reset -- a reboot, or the interface being
    // recreated. Drop the interval rather than charting a huge negative or
    // clamping it to zero, which would read as "no traffic" when the truth is
    // "unknown".
    const rate = (a: number, b: number): number | null => {
      const d = b - a;
      return d < 0 ? null : d / elapsedS;
    };

    const pd = rate(prev.net.primary.rxBytes, cur.net.primary.rxBytes);
    const pu = rate(prev.net.primary.txBytes, cur.net.primary.txBytes);
    const td = rate(prev.net.tailscale.rxBytes, cur.net.tailscale.rxBytes);
    const tu = rate(prev.net.tailscale.txBytes, cur.net.tailscale.txBytes);
    if (pd === null || pu === null || td === null || tu === null) continue;

    out.push({
      t: cur.t,
      primaryDown: pd,
      primaryUp: pu,
      tailscaleDown: td,
      tailscaleUp: tu,
    });
  }
  return out;
}

/** Temperatures need no derivation -- they are already instantaneous readings. */
export function deriveTemps(history: MetricsHistory): TempPoint[] {
  return history.points.map((p) => ({
    t: p.t,
    cpu: p.temps?.cpu ?? null,
    ambient: p.temps?.ambient ?? null,
    gpu: p.temps?.gpu ?? null,
    disks: p.temps?.disks ?? {},
    diskKinds: p.diskKinds ?? {},
  }));
}

/**
 * Watts between consecutive samples, from the RAPL microjoule counters.
 *
 * Shares deriveThroughput's rules, and for the same reasons: real elapsed
 * time rather than the nominal interval, a negative delta dropped as a
 * counter reset (RAPL wraps, which would otherwise render as an enormous
 * spike), and an over-long gap dropped rather than averaged across an
 * outage.
 *
 * This is CPU package and DRAM power, not the machine. Nothing on this box
 * reports a whole-system figure, and presenting these as "power draw" would
 * quietly understate it by everything else in the case.
 */
export function derivePower(history: MetricsHistory): PowerPoint[] {
  const out: PowerPoint[] = [];
  const maxGapMs = history.intervalSeconds * MAX_GAP_MULTIPLE * 1000;

  for (let i = 1; i < history.points.length; i++) {
    const prev = history.points[i - 1];
    const cur = history.points[i];
    const prevMs = Date.parse(prev.t);
    const curMs = Date.parse(cur.t);
    if (!Number.isFinite(prevMs) || !Number.isFinite(curMs)) continue;
    const elapsedS = (curMs - prevMs) / 1000;
    if (elapsedS <= 0 || curMs - prevMs > maxGapMs) continue;

    const watts = (a?: number | null, b?: number | null): number | null => {
      if (typeof a !== "number" || typeof b !== "number") return null;
      const d = b - a;
      // Microjoules per second is microwatts; a negative delta is a wrap.
      return d < 0 ? null : d / elapsedS / 1_000_000;
    };

    const cpuWatts = watts(prev.energy?.packageUj, cur.energy?.packageUj);
    const dramWatts = watts(prev.energy?.dramUj, cur.energy?.dramUj);
    if (cpuWatts === null && dramWatts === null) continue;
    out.push({ t: cur.t, cpuWatts, dramWatts });
  }
  return out;
}

/** Every disk name that appears anywhere in the window, in stable order. */
export function diskNames(points: TempPoint[]): string[] {
  const seen = new Set<string>();
  for (const p of points) for (const k of Object.keys(p.disks)) seen.add(k);
  return [...seen].sort();
}

/**
 * A label a person can read: "SSD" / "HDD" rather than "sda" / "sdb".
 *
 * Device names are meaningless in a legend and are not even stable -- which
 * disk gets which letter can change between boots. The kind comes from the
 * kernel's rotational flag via the sampler. The device is kept in parentheses
 * when two disks share a kind, so the legend never has two identical entries.
 */
export function diskLabel(
  device: string,
  kinds: Record<string, string>,
  allDevices: string[]
): string {
  const kind = kinds[device];
  if (!kind) return device;
  const pretty = kind === "ssd" ? "SSD" : kind === "hdd" ? "HDD" : kind.toUpperCase();
  const sameKind = allDevices.filter((d) => kinds[d] === kind);
  return sameKind.length > 1 ? `${pretty} (${device})` : pretty;
}

export function formatBytesPerSecond(v: number): string {
  if (v < 1024) return `${Math.round(v)} B/s`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB/s`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}
