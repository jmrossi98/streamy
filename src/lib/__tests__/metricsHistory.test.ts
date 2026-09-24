import { describe, it, expect } from "vitest";
import { deriveThroughput, diskNames, formatBytesPerSecond, type MetricsHistory } from "../metricsHistory";

function point(t: string, rx: number, tx: number) {
  return {
    t,
    net: {
      primary: { iface: "enp2s0", rxBytes: rx, txBytes: tx },
      tailscale: { iface: "tailscale0", rxBytes: 0, txBytes: 0 },
    },
    temps: { cpu: 60, ambient: 27, disks: { sda: 43, sdb: 45 } },
    mem: { totalBytes: 100, availableBytes: 50 },
    fs: { root: { totalBytes: 100, freeBytes: 50 }, data: { totalBytes: 100, freeBytes: 50 } },
  };
}

function history(points: ReturnType<typeof point>[]): MetricsHistory {
  return { generatedAt: "", intervalSeconds: 300, points };
}

describe("deriveThroughput", () => {
  it("turns counter deltas into bytes per second", () => {
    const h = history([
      point("2026-09-24T00:00:00Z", 0, 0),
      point("2026-09-24T00:05:00Z", 300_000, 150_000),
    ]);
    const out = deriveThroughput(h);
    expect(out).toHaveLength(1);
    expect(out[0].primaryDown).toBe(1000); // 300000 bytes / 300s
    expect(out[0].primaryUp).toBe(500);
  });

  // Cron drifts and a busy box runs the sampler late. Dividing by an assumed
  // 300s when the real gap was 600s would overstate throughput by 2x.
  it("uses the real elapsed time, not the nominal interval", () => {
    const h = history([
      point("2026-09-24T00:00:00Z", 0, 0),
      point("2026-09-24T00:10:00Z", 600_000, 0),
    ]);
    expect(deriveThroughput(h)[0].primaryDown).toBe(1000);
  });

  // A reboot resets the counter. Charting the negative, or clamping it to
  // zero, both claim something that was not measured.
  it("drops an interval where the counter went backwards", () => {
    const h = history([
      point("2026-09-24T00:00:00Z", 900_000, 0),
      point("2026-09-24T00:05:00Z", 100, 0),
      point("2026-09-24T00:10:00Z", 300_100, 0),
    ]);
    const out = deriveThroughput(h);
    expect(out).toHaveLength(1);
    expect(out[0].t).toBe("2026-09-24T00:10:00Z");
  });

  // Six hours of downtime followed by one sample must not render as a smooth
  // trickle across the whole outage.
  it("drops an interval with a gap far longer than the sampling interval", () => {
    const h = history([
      point("2026-09-24T00:00:00Z", 0, 0),
      point("2026-09-24T06:00:00Z", 999_999_999, 0),
    ]);
    expect(deriveThroughput(h)).toHaveLength(0);
  });

  it("returns nothing for a history too short to have an interval", () => {
    expect(deriveThroughput(history([point("2026-09-24T00:00:00Z", 0, 0)]))).toEqual([]);
  });
});

describe("diskNames", () => {
  it("collects every disk seen anywhere in the window, sorted", () => {
    const names = diskNames([
      { t: "", cpu: null, ambient: null, disks: { sdb: 45 } },
      { t: "", cpu: null, ambient: null, disks: { sda: 43, sdb: 45 } },
    ]);
    expect(names).toEqual(["sda", "sdb"]);
  });
});

describe("formatBytesPerSecond", () => {
  it("scales units", () => {
    expect(formatBytesPerSecond(512)).toBe("512 B/s");
    expect(formatBytesPerSecond(2048)).toBe("2.0 KB/s");
    expect(formatBytesPerSecond(5 * 1024 * 1024)).toBe("5.0 MB/s");
  });
});
