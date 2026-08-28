"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { VisitorMap } from "@/lib/visitorMapData";
import { pinRadius, type MapPin, type VisitSource } from "@/lib/visitorMap";

// A real slippy map (OpenStreetMap tiles via Leaflet), so it zooms with the
// wheel/pinch and pans by dragging like any map -- not the hand-rolled SVG it
// replaced. This panel is admin-only, so pulling OSM tiles into the admin's own
// browser doesn't touch the no-third-party stance, which is about VISITOR data.
// The pins still come from the server; only the basemap is external.

const SOURCE_META: Record<VisitSource, { label: string; color: string }> = {
  portfolio: { label: "Portfolio", color: "#38bdf8" }, // sky
  streamy: { label: "Streamy", color: "#e50914" }, // netflix red
  "login-success": { label: "Sign-ins", color: "#22c55e" }, // green — got in
  "login-fail": { label: "Failed sign-ins", color: "#f59e0b" }, // amber — didn't
};

function dominantSource(pin: MapPin): VisitSource {
  const entries = Object.entries(pin.bySource) as [VisitSource, number][];
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

// Escape place names before putting them in popup HTML. They come from GeoLite2,
// not a user, but building HTML from any data without escaping is a bad habit.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

export function VisitorMapPanel() {
  const [map, setMap] = useState<VisitorMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch the map data on demand (keeps opening Admin cheap).
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

  // Build the Leaflet map once data and the container are both ready. Leaflet is
  // imported dynamically inside the effect so it never runs during SSR (it
  // touches window/document on use).
  useEffect(() => {
    if (!map?.configured || !map.ready || map.pins.length === 0 || !containerRef.current) return;
    const el = containerRef.current;
    let removed = false;
    let instance: import("leaflet").Map | null = null;

    (async () => {
      const L = (await import("leaflet")).default;
      if (removed || !el) return;

      instance = L.map(el, { worldCopyJump: true, scrollWheelZoom: true }).setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(instance);

      const maxTotal = map.pins[0]?.total ?? 1;
      const latLngs: [number, number][] = [];
      for (const pin of map.pins) {
        const color = SOURCE_META[dominantSource(pin)].color;
        const parts = (Object.keys(SOURCE_META) as VisitSource[])
          .filter((s) => pin.bySource[s] > 0)
          .map((s) => `${SOURCE_META[s].label}: ${pin.bySource[s]}`)
          .join("<br>");
        L.circleMarker([pin.lat, pin.lon], {
          radius: pinRadius(pin.total, maxTotal),
          color,
          fillColor: color,
          fillOpacity: 0.55,
          weight: 1,
        })
          .bindPopup(`<strong>${esc(pin.label)}</strong><br>${parts}`)
          .addTo(instance);
        latLngs.push([pin.lat, pin.lon]);
      }
      // Frame the pins, but don't zoom in so far that a single cluster fills the
      // world; the user can zoom further by hand.
      if (latLngs.length) instance.fitBounds(latLngs, { padding: [30, 30], maxZoom: 6 });
    })();

    return () => {
      removed = true;
      if (instance) instance.remove();
    };
  }, [map]);

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

      {/* Leaflet renders into this; it needs an explicit height. */}
      <div
        ref={containerRef}
        className="h-[420px] w-full overflow-hidden rounded-lg border border-white/10"
        style={{ background: "#0b0b0f" }}
      />

      <p className="text-xs text-white/30">
        City-level from GeoLite2, resolved on this server — no visitor address is sent anywhere.
        Basemap tiles are from OpenStreetMap. Positions are approximate.
      </p>
    </div>
  );
}
