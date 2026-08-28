import { describe, it, expect } from "vitest";
import {
  aggregatePins,
  pinRadius,
  project,
  totals,
  type LocatedVisit,
} from "../visitorMap";

// The projection and the grouping are the parts that place a dot on a map, and
// a mistake in either is invisible until a pin sits in the ocean or every
// visitor collapses onto one point. Tested here rather than by squinting.

describe("project", () => {
  it("puts the equator/prime-meridian origin at the centre", () => {
    expect(project(0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("puts the north-west corner at the top left", () => {
    // 90N, 180W -> top-left (0,0).
    expect(project(90, -180)).toEqual({ x: 0, y: 0 });
    // 90S, 180E -> bottom-right (1,1).
    expect(project(-90, 180)).toEqual({ x: 1, y: 1 });
  });

  it("keeps north at the top (higher latitude = smaller y)", () => {
    expect(project(45, 0).y).toBeLessThan(project(-45, 0).y);
  });

  it("clamps out-of-range coordinates onto the canvas", () => {
    const p = project(200, 400);
    expect(p.x).toBeLessThanOrEqual(1);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });
});

function visit(partial: Partial<LocatedVisit>): LocatedVisit {
  return { lat: 0, lon: 0, city: null, country: null, source: "portfolio", ...partial };
}

describe("aggregatePins", () => {
  it("merges visits in the same place into one pin and counts sources", () => {
    const pins = aggregatePins([
      visit({ lat: 40.71, lon: -74.0, city: "New York", country: "United States", source: "portfolio" }),
      visit({ lat: 40.72, lon: -74.01, city: "New York", country: "United States", source: "login" }),
      visit({ lat: 40.7, lon: -74.0, city: "New York", country: "United States", source: "streamy" }),
    ]);
    expect(pins).toHaveLength(1);
    expect(pins[0].total).toBe(3);
    expect(pins[0].bySource).toEqual({ portfolio: 1, login: 1, streamy: 1 });
    expect(pins[0].label).toBe("New York, United States");
  });

  it("keeps distant places as separate pins", () => {
    const pins = aggregatePins([
      visit({ lat: 40.71, lon: -74.0, city: "New York" }),
      visit({ lat: 51.5, lon: -0.13, city: "London" }),
    ]);
    expect(pins).toHaveLength(2);
  });

  it("orders pins busiest first, so big places draw on top", () => {
    const pins = aggregatePins([
      visit({ lat: 51.5, lon: -0.13, city: "London" }),
      visit({ lat: 40.71, lon: -74.0, city: "New York" }),
      visit({ lat: 40.71, lon: -74.0, city: "New York" }),
    ]);
    expect(pins[0].label).toContain("New York");
    expect(pins[0].total).toBe(2);
  });

  // A pin should sit among its visitors, not snap to the grid-cell corner.
  // Both points share one ~0.5-degree cell (they round to 40.5), so they merge
  // and the pin lands at their mean.
  it("places a pin at the mean of its members", () => {
    const pins = aggregatePins([
      visit({ lat: 40.55, lon: -74.0 }),
      visit({ lat: 40.65, lon: -74.0 }),
    ]);
    expect(pins).toHaveLength(1);
    expect(pins[0].lat).toBeCloseTo(40.6, 5);
  });

  it("falls back to coordinates when a place has no name", () => {
    const pins = aggregatePins([visit({ lat: 12.34, lon: 56.78, city: null, country: null })]);
    expect(pins[0].label).toBe("12.3, 56.8");
  });
});

describe("pinRadius", () => {
  it("is the minimum when everything is equal", () => {
    expect(pinRadius(1, 1)).toBe(3);
  });

  it("grows with count but sub-linearly", () => {
    const one = pinRadius(1, 100);
    const hundred = pinRadius(100, 100);
    expect(hundred).toBeGreaterThan(one);
    // 100x the visits must not be 100x the radius, or one pin swamps the map.
    expect(hundred / one).toBeLessThan(20);
  });
});

describe("totals", () => {
  it("sums visits and sources across pins", () => {
    const pins = aggregatePins([
      visit({ lat: 40.71, lon: -74.0, source: "portfolio" }),
      visit({ lat: 51.5, lon: -0.13, source: "login" }),
      visit({ lat: 51.5, lon: -0.13, source: "streamy" }),
    ]);
    expect(totals(pins)).toEqual({
      pins: 2,
      visits: 3,
      bySource: { portfolio: 1, streamy: 1, login: 1 },
    });
  });
});
