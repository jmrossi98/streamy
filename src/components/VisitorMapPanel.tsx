"use client";

import { useState } from "react";
import type { VisitorMap } from "@/lib/visitorMapData";
import { pinRadius, type MapPin, type VisitSource } from "@/lib/visitorMap";
import { WORLD_LAND_PATH, WORLD_VIEWBOX } from "./worldMapPath";

// Equirectangular canvas, 2:1 like the projection. The pin x/y are 0..1, so
// they scale straight onto this viewBox -- and it matches the world path's own
// viewBox, so coastlines and pins share one coordinate space.
const W = WORLD_VIEWBOX.w;
const H = WORLD_VIEWBOX.h;

const SOURCE_META: Record<VisitSource, { label: string; color: string }> = {
  portfolio: { label: "Portfolio", color: "#38bdf8" }, // sky
  streamy: { label: "Streamy", color: "#e50914" }, // netflix red
  login: { label: "Sign-ins", color: "#f59e0b" }, // amber
};

/** The source contributing the most visits to a pin decides its colour. */
function dominantSource(pin: MapPin): VisitSource {
  const entries = Object.entries(pin.bySource) as [VisitSource, number][];
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function Graticule() {
  const lines = [];
  // Meridians every 30 degrees.
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = ((lon + 180) / 360) * W;
    lines.push(
      <line
        key={`m${lon}`}
        x1={x}
        y1={0}
        x2={x}
        y2={H}
        stroke={lon === 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)"}
        strokeWidth={1}
      />
    );
  }
  // Parallels every 30 degrees.
  for (let lat = -90; lat <= 90; lat += 30) {
    const y = ((90 - lat) / 180) * H;
    lines.push(
      <line
        key={`p${lat}`}
        x1={0}
        y1={y}
        x2={W}
        y2={y}
        stroke={lat === 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)"}
        strokeWidth={1}
      />
    );
  }
  return <g>{lines}</g>;
}

export function VisitorMapPanel({ map }: { map: VisitorMap }) {
  const [hover, setHover] = useState<MapPin | null>(null);

  if (!map.configured) {
    return (
      <p className="text-sm text-white/50">
        The map needs geolocation. Set{" "}
        <code className="text-white/70">MAXMIND_LICENSE_KEY</code> (a free GeoLite2 key) on the
        server and it will download the database on its own.
      </p>
    );
  }

  if (!map.ready) {
    return (
      <p className="text-sm text-white/50">
        Downloading the GeoLite2 database… this happens once and takes a minute. Refresh shortly and
        the map will fill in.
      </p>
    );
  }

  if (map.pins.length === 0) {
    return (
      <p className="text-sm text-white/50">
        No visits could be placed yet. Public visits appear here once they arrive; private and
        local addresses are never mapped.
      </p>
    );
  }

  const maxTotal = map.pins[0]?.total ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        {(Object.keys(SOURCE_META) as VisitSource[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-white/60">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: SOURCE_META[s].color }}
            />
            {SOURCE_META[s].label}
            <span className="text-white/35">{map.totals.bySource[s]}</span>
          </span>
        ))}
        <span className="ml-auto text-white/40">
          {map.totals.pins} locations · {map.totals.visits} visits
          {map.unplaceable > 0 ? ` · ${map.unplaceable} unplaceable` : ""}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black/40">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Visitor map">
          {/* Landmasses first, then the graticule over them, then pins on top. */}
          <path d={WORLD_LAND_PATH} fill="rgba(255,255,255,0.09)" stroke="rgba(255,255,255,0.16)" strokeWidth={0.5} />
          <Graticule />
          {/* Largest pins are first in the array; render reversed so they end up
              painted on top of the smaller ones rather than under them. */}
          {[...map.pins].reverse().map((pin, i) => {
            const color = SOURCE_META[dominantSource(pin)].color;
            const r = pinRadius(pin.total, maxTotal);
            return (
              <circle
                key={`${pin.x}-${pin.y}-${i}`}
                cx={pin.x * W}
                cy={pin.y * H}
                r={r}
                fill={color}
                fillOpacity={0.55}
                stroke={color}
                strokeWidth={1}
                onMouseEnter={() => setHover(pin)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              >
                <title>
                  {pin.label} — {pin.total} visit{pin.total === 1 ? "" : "s"}
                </title>
              </circle>
            );
          })}
        </svg>

        {hover && (
          <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/80 px-3 py-2 text-xs text-white shadow-lg">
            <p className="font-medium">{hover.label}</p>
            <p className="mt-0.5 text-white/60">
              {(Object.keys(SOURCE_META) as VisitSource[])
                .filter((s) => hover.bySource[s] > 0)
                .map((s) => `${SOURCE_META[s].label}: ${hover.bySource[s]}`)
                .join(" · ")}
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-white/30">
        City-level from GeoLite2, resolved on this server — no visitor address is sent anywhere.
        Positions are approximate.
      </p>
    </div>
  );
}
