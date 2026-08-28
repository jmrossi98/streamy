/**
 * Pure aggregation and projection for the visitor map.
 *
 * Kept free of the database and the geo reader so it can be tested directly:
 * the grouping (many visits from one place become one pin) and the projection
 * (lat/long to an x/y on an equirectangular map) are exactly the parts that are
 * easy to get subtly wrong and impossible to eyeball on a live map.
 */

/** One located visit, from any source. */
export type LocatedVisit = {
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  /** Which stream it came from, so a pin can show the mix. */
  source: VisitSource;
};

export type VisitSource = "portfolio" | "streamy" | "login";

export type MapPin = {
  lat: number;
  lon: number;
  /** Best available label: "City, Country", or a country, or coordinates. */
  label: string;
  total: number;
  bySource: Record<VisitSource, number>;
  /** Projected position, 0..1 on each axis, for placing on any-sized map. */
  x: number;
  y: number;
};

/**
 * Equirectangular projection to a 0..1 unit square.
 *
 * x from longitude across -180..180, y from latitude across 90..-90 (north at
 * the top). The map SVG uses the same projection, so a pin at (x,y) lands where
 * the coastline says it should. Values are clamped, since a bad record could
 * carry an out-of-range coordinate that would otherwise place a pin off-canvas.
 */
export function project(lat: number, lon: number): { x: number; y: number } {
  const x = (lon + 180) / 360;
  const y = (90 - lat) / 180;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(x), y: clamp(y) };
}

/** Rounds to a grid so nearby visits share a pin instead of scattering. */
function cellKey(lat: number, lon: number): string {
  // ~0.5 degree cells: fine enough to separate cities, coarse enough that the
  // same city from slightly different IP records lands on one pin.
  const round = (v: number) => Math.round(v * 2) / 2;
  return `${round(lat)},${round(lon)}`;
}

function emptyBySource(): Record<VisitSource, number> {
  return { portfolio: 0, streamy: 0, login: 0 };
}

function labelFor(city: string | null, country: string | null, lat: number, lon: number): string {
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  return `${lat.toFixed(1)}, ${lon.toFixed(1)}`;
}

/**
 * Collapses located visits into map pins.
 *
 * Visits within the same grid cell merge into one pin whose position is the
 * mean of its members -- so a pin sits among its visitors rather than snapping
 * to the cell corner -- and whose label comes from the most common place name
 * in the cell. Pins are returned largest first, so the busiest places draw on
 * top rather than being hidden under smaller ones.
 */
export function aggregatePins(visits: LocatedVisit[]): MapPin[] {
  const cells = new Map<
    string,
    {
      latSum: number;
      lonSum: number;
      count: number;
      bySource: Record<VisitSource, number>;
      labels: Map<string, number>;
    }
  >();

  for (const v of visits) {
    const key = cellKey(v.lat, v.lon);
    let cell = cells.get(key);
    if (!cell) {
      cell = { latSum: 0, lonSum: 0, count: 0, bySource: emptyBySource(), labels: new Map() };
      cells.set(key, cell);
    }
    cell.latSum += v.lat;
    cell.lonSum += v.lon;
    cell.count += 1;
    cell.bySource[v.source] += 1;
    const label = labelFor(v.city, v.country, v.lat, v.lon);
    cell.labels.set(label, (cell.labels.get(label) ?? 0) + 1);
  }

  const pins: MapPin[] = [];
  for (const cell of cells.values()) {
    const lat = cell.latSum / cell.count;
    const lon = cell.lonSum / cell.count;
    // Most frequent label in the cell wins.
    let label = "";
    let best = -1;
    for (const [name, n] of cell.labels) {
      if (n > best) {
        best = n;
        label = name;
      }
    }
    pins.push({
      lat,
      lon,
      label,
      total: cell.count,
      bySource: cell.bySource,
      ...project(lat, lon),
    });
  }

  return pins.sort((a, b) => b.total - a.total);
}

/** Radius for a pin, so a busy place reads as bigger without swamping the map. */
export function pinRadius(total: number, max: number): number {
  const MIN = 3;
  const MAX = 14;
  if (max <= 1) return MIN;
  // Square-root scale: area tracks count, so ten visits isn't ten times the
  // width of one -- which would drown the map in a single circle.
  const t = Math.sqrt(total) / Math.sqrt(max);
  return MIN + t * (MAX - MIN);
}

export type MapTotals = { pins: number; visits: number; bySource: Record<VisitSource, number> };

export function totals(pins: MapPin[]): MapTotals {
  const bySource = emptyBySource();
  let visits = 0;
  for (const pin of pins) {
    visits += pin.total;
    bySource.portfolio += pin.bySource.portfolio;
    bySource.streamy += pin.bySource.streamy;
    bySource.login += pin.bySource.login;
  }
  return { pins: pins.length, visits, bySource };
}
