"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VisitorMap } from "@/lib/visitorMapData";
import { pinRadius, type MapPin, type VisitSource } from "@/lib/visitorMap";
import { WORLD_LAND_PATH, WORLD_VIEWBOX } from "./worldMapPath";

type Box = { x: number; y: number; w: number; h: number };
const FULL: Box = { x: 0, y: 0, w: WORLD_VIEWBOX.w, h: WORLD_VIEWBOX.h };
// Deepest zoom: 1/12th of the world across, enough to pull apart a cluster of
// cities without letting the map become a meaningless close-up of empty ocean.
const MIN_W = WORLD_VIEWBOX.w / 12;

// Equirectangular canvas, 2:1 like the projection. The pin x/y are 0..1, so
// they scale straight onto this viewBox -- and it matches the world path's own
// viewBox, so coastlines and pins share one coordinate space.
const W = WORLD_VIEWBOX.w;
const H = WORLD_VIEWBOX.h;

const SOURCE_META: Record<VisitSource, { label: string; color: string }> = {
  portfolio: { label: "Portfolio", color: "#38bdf8" }, // sky
  streamy: { label: "Streamy", color: "#e50914" }, // netflix red
  "login-success": { label: "Sign-ins", color: "#22c55e" }, // green — got in
  "login-fail": { label: "Failed sign-ins", color: "#f59e0b" }, // amber — didn't
};

/** The source contributing the most visits to a pin decides its colour. */
function dominantSource(pin: MapPin): VisitSource {
  const entries = Object.entries(pin.bySource) as [VisitSource, number][];
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function Graticule({ sw }: { sw: number }) {
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
        strokeWidth={sw}
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
        strokeWidth={sw}
      />
    );
  }
  return <g>{lines}</g>;
}

export function VisitorMapPanel() {
  // The map data is fetched on demand rather than passed in, so opening the
  // admin page doesn't pay for the GeoLite2 mmap and per-IP geolocation every
  // time. It loads only when this panel is actually on screen.
  const [map, setMap] = useState<VisitorMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hover, setHover] = useState<MapPin | null>(null);
  const [view, setView] = useState<Box>(FULL);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/visitor-map")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: VisitorMap) => {
        if (!cancelled) setMap(data);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keeps the view inside the world and within the zoom limits.
  const clampBox = useCallback((b: Box): Box => {
    const w = Math.min(FULL.w, Math.max(MIN_W, b.w));
    const h = w * (FULL.h / FULL.w);
    const x = Math.min(FULL.w - w, Math.max(0, b.x));
    const y = Math.min(FULL.h - h, Math.max(0, b.y));
    return { x, y, w, h };
  }, []);

  const zoomAt = useCallback(
    (factor: number, fx: number, fy: number) => {
      setView((v) => {
        // fx/fy are 0..1 within the current view; keep that point fixed.
        const cx = v.x + fx * v.w;
        const cy = v.y + fy * v.h;
        const nw = v.w * factor;
        const nh = v.h * factor;
        return clampBox({ x: cx - fx * nw, y: cy - fy * nh, w: nw, h: nh });
      });
    },
    [clampBox]
  );

  // Wheel zoom, attached as a non-passive listener so preventDefault works and
  // the page doesn't scroll while zooming the map.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      zoomAt(e.deltaY < 0 ? 0.85 : 1 / 0.85, fx, fy);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    drag.current = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y };
    setGrabbing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Screen delta -> viewBox delta; drag moves the map with the cursor.
    const dx = ((e.clientX - d.px) / rect.width) * view.w;
    const dy = ((e.clientY - d.py) / rect.height) * view.h;
    setView(clampBox({ ...view, x: d.ox - dx, y: d.oy - dy }));
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    drag.current = null;
    setGrabbing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  // Pin and stroke sizes divide by the zoom factor so they stay a constant size
  // on screen -- zooming in separates overlapping pins instead of inflating them.
  const zoom = FULL.w / view.w;
  const zoomed = view.w < FULL.w - 0.5;

  if (loadError) {
    return <p className="text-sm text-red-300">Couldn&apos;t load the map: {loadError}</p>;
  }
  if (!map) {
    return <p className="text-sm text-white/50">Loading the map…</p>;
  }

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
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="block w-full touch-none select-none"
          role="img"
          aria-label="Visitor map"
          style={{ cursor: grabbing ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* Landmasses first, then the graticule over them, then pins on top. */}
          <path
            d={WORLD_LAND_PATH}
            fill="rgba(255,255,255,0.09)"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth={0.5 / zoom}
          />
          <Graticule sw={1 / zoom} />
          {/* Largest pins are first in the array; render reversed so they end up
              painted on top of the smaller ones rather than under them. */}
          {[...map.pins].reverse().map((pin, i) => {
            const color = SOURCE_META[dominantSource(pin)].color;
            // Divide by zoom so the pin keeps a constant on-screen size; zooming
            // in then separates a cluster instead of scaling the blobs with it.
            const r = pinRadius(pin.total, maxTotal) / zoom;
            return (
              <circle
                key={`${pin.x}-${pin.y}-${i}`}
                cx={pin.x * W}
                cy={pin.y * H}
                r={r}
                fill={color}
                fillOpacity={0.55}
                stroke={color}
                strokeWidth={1 / zoom}
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

        {/* Zoom controls, overlaid. Buttons zoom about the map centre. */}
        <div className="absolute bottom-2 right-2 flex flex-col gap-1">
          <button
            onClick={() => zoomAt(0.7, 0.5, 0.5)}
            className="h-7 w-7 rounded bg-black/70 text-lg leading-none text-white/80 hover:text-white"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => zoomAt(1 / 0.7, 0.5, 0.5)}
            className="h-7 w-7 rounded bg-black/70 text-lg leading-none text-white/80 hover:text-white"
            aria-label="Zoom out"
          >
            −
          </button>
          {zoomed && (
            <button
              onClick={() => setView(FULL)}
              className="h-7 w-7 rounded bg-black/70 text-xs leading-none text-white/80 hover:text-white"
              aria-label="Reset view"
              title="Reset"
            >
              ⤢
            </button>
          )}
        </div>

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
