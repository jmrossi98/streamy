import { describe, it, expect } from "vitest";
import {
  buildView,
  clientsNow,
  deriveClientSeries,
  nodeLabel,
  pathEvents,
  pathLabel,
} from "../exitNodeClientsRules";
import type { ExitClientPoint, ExitNodeClientsHistory } from "../exitNodeClients";

const NODES = [
  { name: "mediabox-pia", container: "tailscale-exit", role: "primary (US)", readable: true },
  { name: "mediabox-pia-ca", container: "tailscale-exit-pf", role: "standby (Toronto)", readable: true },
];

const T0 = Date.parse("2026-10-20T21:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString().replace(".000Z", "+00:00");

type Dev = { p: string | null; rx: number; tx: number };
function point(minutes: number, us: Record<string, Dev> = {}, ca: Record<string, Dev> = {}): ExitClientPoint {
  return { t: at(minutes), nodes: { "mediabox-pia": us, "mediabox-pia-ca": ca } };
}

function history(points: ExitClientPoint[], now: ExitNodeClientsHistory["now"] = {}): ExitNodeClientsHistory {
  return { generatedAt: points.at(-1)?.t ?? at(0), intervalSeconds: 60, nodes: NODES, now, points };
}

// 7.5 MB in 60 s is exactly 1 Mbit/s, which keeps the expectations readable.
const MB_PER_MBIT_MINUTE = 7_500_000;

describe("deriveClientSeries", () => {
  it("turns counter deltas into Mbit/s, download from the node's Tx", () => {
    const h = history([
      point(0, { phone: { p: "direct", rx: 0, tx: 0 } }),
      point(1, { phone: { p: "direct", rx: MB_PER_MBIT_MINUTE / 2, tx: MB_PER_MBIT_MINUTE * 3 } }),
    ]);
    const { times, series } = deriveClientSeries(h);
    expect(times).toEqual([at(1)]);
    expect(series).toHaveLength(1);
    expect(series[0].label).toBe("phone · US");
    expect(series[0].down[0]).toBeCloseTo(3, 5);
    expect(series[0].up[0]).toBeCloseTo(0.5, 5);
    expect(series[0].paths).toEqual(["direct"]);
  });

  // tailscaled restarting with its tunnel zeroes the counters. That interval
  // is unknown, not a huge negative and not zero traffic.
  it("drops an interval where a counter went backwards", () => {
    const h = history([
      point(0, { phone: { p: "direct", rx: 0, tx: 9_000_000 } }),
      point(1, { phone: { p: "direct", rx: 0, tx: 100 } }),
      point(2, { phone: { p: "direct", rx: 0, tx: 100 + MB_PER_MBIT_MINUTE } }),
    ]);
    const { series } = deriveClientSeries(h);
    expect(series[0].down).toEqual([null, 1]);
  });

  it("drops an interval across a gap much longer than the sampling period", () => {
    const h = history([
      point(0, { phone: { p: "direct", rx: 0, tx: 0 } }),
      point(10, { phone: { p: "direct", rx: 0, tx: MB_PER_MBIT_MINUTE } }),
      point(11, { phone: { p: "direct", rx: 0, tx: 2 * MB_PER_MBIT_MINUTE } }),
    ]);
    const { series } = deriveClientSeries(h);
    expect(series[0].down).toEqual([null, 1]);
  });

  it("aligns a device that appears mid-window and leaves out one that never moved bytes", () => {
    const h = history([
      point(0, { phone: { p: "direct", rx: 0, tx: 0 }, deck: { p: null, rx: 5, tx: 5 } }),
      point(1, { phone: { p: "direct", rx: 0, tx: MB_PER_MBIT_MINUTE }, deck: { p: null, rx: 5, tx: 5 } }),
      point(2, { phone: { p: "direct", rx: 0, tx: MB_PER_MBIT_MINUTE } }, { laptop: { p: "peer-relay", rx: 0, tx: 0 } }),
      point(3, { phone: { p: "direct", rx: 0, tx: MB_PER_MBIT_MINUTE } }, { laptop: { p: "peer-relay", rx: 0, tx: 2 * MB_PER_MBIT_MINUTE } }),
    ]);
    const { times, series } = deriveClientSeries(h);
    expect(times).toHaveLength(3);
    // The laptop moved 15 MB to the phone's 7.5 MB, so it sorts first.
    expect(series.map((s) => s.label)).toEqual(["laptop · Toronto", "phone · US"]);
    expect(series[0].down).toEqual([null, null, 2]);
    expect(series[1].down).toEqual([1, 0, 0]);
  });

  it("orders the busiest device first", () => {
    const h = history([
      point(0, { phone: { p: "direct", rx: 0, tx: 0 }, laptop: { p: "peer-relay", rx: 0, tx: 0 } }),
      point(1, { phone: { p: "direct", rx: 0, tx: 10 }, laptop: { p: "peer-relay", rx: 0, tx: 1000 } }),
    ]);
    expect(deriveClientSeries(h).series.map((s) => s.device)).toEqual(["laptop", "phone"]);
  });
});

describe("pathEvents", () => {
  it("records every path change, newest first, including appearing and dropping", () => {
    const h = history([
      point(0, { phone: { p: "direct", rx: 0, tx: 0 } }),
      point(1, { phone: { p: "derp:nyc", rx: 0, tx: 0 } }),
      point(2, { phone: { p: "derp:nyc", rx: 0, tx: 0 } }),
      point(3, { phone: { p: "direct", rx: 0, tx: 0 } }),
      point(4, {}),
    ]);
    expect(pathEvents(h)).toEqual([
      { t: at(4), device: "phone", node: "mediabox-pia", from: "direct", to: null },
      { t: at(3), device: "phone", node: "mediabox-pia", from: "derp:nyc", to: "direct" },
      { t: at(1), device: "phone", node: "mediabox-pia", from: "direct", to: "derp:nyc" },
    ]);
  });
});

describe("clientsNow", () => {
  const nowEntry = (over: Partial<ExitNodeClientsHistory["now"][string][string]> = {}) => ({
    os: "iOS",
    active: true,
    path: "direct",
    endpoint: "192.168.0.27:41641",
    rxBytes: 1,
    txBytes: 1,
    lastHandshake: at(5),
    ...over,
  });

  it("gives the latest interval's rates and the last hour's DERP minutes and flips", () => {
    const pts: ExitClientPoint[] = [];
    for (let m = 0; m <= 5; m++) {
      pts.push(point(m, { phone: { p: m === 2 || m === 3 ? "derp:nyc" : "direct", rx: 0, tx: m * MB_PER_MBIT_MINUTE } }));
    }
    const h = history(pts, { "mediabox-pia": { phone: nowEntry() }, "mediabox-pia-ca": { phone: nowEntry({ active: false, path: null, rxBytes: 0, txBytes: 0 }) } });
    const rows = clientsNow(h, T0 + 5 * 60_000, pathEvents(h));
    expect(rows).toHaveLength(1); // idle on Toronto, so no second row
    expect(rows[0]).toMatchObject({ device: "phone", nodeLabel: "US", active: true, path: "direct", derpMinutesLastHour: 2, pathChangesLastHour: 2 });
    expect(rows[0].downMbps).toBeCloseTo(1, 5);
  });

  it("keeps one row for a device idle everywhere, active devices first", () => {
    const h = history([point(0), point(1)], {
      "mediabox-pia": { deck: nowEntry({ active: false, path: null, rxBytes: 0, txBytes: 0 }), phone: nowEntry() },
      "mediabox-pia-ca": { deck: nowEntry({ active: false, path: null, rxBytes: 0, txBytes: 0 }) },
    });
    const rows = clientsNow(h, T0, []);
    expect(rows.map((r) => [r.device, r.node, r.active])).toEqual([
      ["phone", "mediabox-pia", true],
      ["deck", "mediabox-pia", false],
    ]);
    expect(rows[1].downMbps).toBeNull();
  });
});

describe("buildView", () => {
  it("is empty but honest when nothing was published", () => {
    expect(buildView(null, T0, false)).toMatchObject({ configured: false, generatedAt: null, stale: false, clients: [], series: [] });
  });

  it("flags a history older than the stale limit", () => {
    const h = history([point(0), point(1)]);
    expect(buildView(h, T0 + 60_000 + 10_000, true).stale).toBe(false);
    expect(buildView(h, T0 + 60_000 + 200_000, true)).toMatchObject({ stale: true, ageSeconds: 200 });
  });
});

describe("labels", () => {
  it("reads the place out of the sampler's role", () => {
    expect(nodeLabel("mediabox-pia", NODES)).toBe("US");
    expect(nodeLabel("mediabox-pia-ca", NODES)).toBe("Toronto");
    expect(nodeLabel("unknown", NODES)).toBe("unknown");
  });

  it("names paths for people", () => {
    expect(pathLabel("direct")).toBe("direct");
    expect(pathLabel("peer-relay")).toBe("peer relay");
    expect(pathLabel("derp:nyc")).toBe("DERP nyc");
    expect(pathLabel(null)).toBe("idle");
  });
});
