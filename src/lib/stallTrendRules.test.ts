import { describe, expect, it } from "vitest";
import { hourlyTrend, trendSummary } from "./stallTrendRules";

const H = 3_600_000;
// 2026-10-18T19:30:00Z
const NOW = Date.UTC(2026, 9, 18, 19, 30);

describe("hourlyTrend", () => {
  it("lays events into whole hours, oldest first, with empty hours present", () => {
    const b = hourlyTrend(
      [
        { at: NOW - 10 * 60_000, kind: "start", ms: null },
        { at: NOW - 9 * 60_000, kind: "playing", ms: 1800 },
        { at: NOW - 8 * 60_000, kind: "playing", ms: 2400 },
        { at: NOW - 5 * 60_000, kind: "stall", ms: 2500 },
        { at: NOW - 4 * 60_000, kind: "stall", ms: 1500 },
        { at: NOW - 3 * H, kind: "error", ms: null },
        { at: NOW - 30 * H, kind: "stall", ms: 99_000 }, // outside the day
      ],
      NOW,
      24
    );
    expect(b).toHaveLength(24);
    expect(b[0].start).toBe(Date.UTC(2026, 9, 17, 20));
    expect(b[23].start).toBe(Date.UTC(2026, 9, 18, 19));
    expect(b[23]).toMatchObject({ starts: 1, stalls: 2, stallSeconds: 4, medianStartMs: 2100 });
    expect(b[20]).toMatchObject({ errors: 1, stalls: 0 });
    expect(b.reduce((a, x) => a + x.stalls, 0)).toBe(2);
  });
});

describe("trendSummary", () => {
  it("rates stalls per ten starts and names the worst hour", () => {
    const b = hourlyTrend(
      [
        ...Array.from({ length: 5 }, (_, i) => ({ at: NOW - i * 60_000, kind: "start", ms: null })),
        { at: NOW - 60_000, kind: "stall", ms: 3000 },
        { at: NOW - 2 * H, kind: "stall", ms: 20_000 },
      ],
      NOW
    );
    const s = trendSummary(b);
    expect(s.starts).toBe(5);
    expect(s.stalls).toBe(2);
    expect(s.stallsPerTenStarts).toBe(4);
    expect(s.worst?.start).toBe(Date.UTC(2026, 9, 18, 17));
  });

  it("has no rate without starts", () => {
    const s = trendSummary(hourlyTrend([], NOW));
    expect(s.stallsPerTenStarts).toBeNull();
    expect(s.worst).toBeNull();
  });
});
