"use client";

import { useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import type { ExitNodeClientsView } from "@/app/api/admin/exit-nodes/route";
import { MAX_CHART_SERIES, isDerp, pathLabel, type ClientNow, type PathEvent } from "@/lib/exitNodeClientsRules";

const POLL_MS = 15_000;
const EVENTS_SHOWN = 12;

/**
 * Who is on the exit nodes, how each device is reaching them, and how much
 * is flowing to each over the day -- so "the exit node is slow on my phone"
 * can be read off a chart while it is happening instead of reconstructed
 * afterwards.
 *
 * The path column is the one to look at first. A phone on home Wi-Fi should
 * sit on "direct"; anything away from home on "peer relay" (the host relays
 * it, ~1 ms). "DERP" means the direct path failed and traffic is detouring
 * through a Tailscale relay server: expect a fraction of the throughput and
 * stalls while it flips back. Polls while open and visible.
 */
export function ExitNodeClientsPanel() {
  const [data, setData] = useState<ExitNodeClientsView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/admin/exit-nodes", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: ExitNodeClientsView) => {
          if (!live) return;
          setData(d);
          setFailed(false);
        })
        .catch(() => live && setFailed(true));
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (!data) return <p className="text-sm text-white/50">{failed ? "Couldn’t read the exit node clients." : "Loading…"}</p>;
  if (!data.configured) return <p className="text-sm text-white/40">FLASH_LIBRARY_URL isn’t set, so mediabox’s status files can’t be read.</p>;
  if (!data.generatedAt) {
    return <p className="text-sm text-white/40">No client history published yet — is exit-node-clients.py running on the box?</p>;
  }

  const unreadable = data.nodes.filter((n) => !n.readable);
  const charted = data.series.slice(0, MAX_CHART_SERIES);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-white/35">
        <span>updated {new Date(data.generatedAt).toLocaleTimeString()}</span>
        {data.stale && <Badge tone="danger">stale · {Math.round((data.ageSeconds ?? 0) / 60)} min old</Badge>}
        {failed && <span>· last refresh failed</span>}
        {unreadable.map((n) => (
          <Badge key={n.name} tone="warning">
            {n.name}: status unreadable
          </Badge>
        ))}
      </div>

      <ClientsTable clients={data.clients} />

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-medium text-white/80">Download to each device (24h)</h3>
          <p className="text-xs text-white/35">
            What the exit node sent to the device, averaged over each minute. A dip with the path still direct is the box or the tunnel; a
            dip as the path flips to DERP is the path.
          </p>
        </div>
        <TimeSeriesChart
          times={data.times}
          unit="megabitsPerSecond"
          series={charted.map((s) => ({ label: s.label, values: s.down }))}
          emptyMessage="Not enough history yet - the sampler runs every minute."
        />
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-medium text-white/80">Upload from each device (24h)</h3>
        </div>
        <TimeSeriesChart
          times={data.times}
          unit="megabitsPerSecond"
          height={160}
          series={charted.map((s) => ({ label: s.label, values: s.up }))}
          emptyMessage="Not enough history yet - the sampler runs every minute."
        />
      </section>

      {data.series.length > MAX_CHART_SERIES && (
        <p className="text-xs text-white/35">
          Charting the {MAX_CHART_SERIES} busiest of {data.series.length} device sessions.
        </p>
      )}

      <PathEvents events={data.events} />
    </div>
  );
}

const PATH_TONE = (path: string | null): BadgeTone =>
  !path ? "neutral" : path === "direct" ? "success" : path === "peer-relay" ? "info" : "warning";

const mbps = (v: number | null) => (v === null ? "–" : v < 0.05 ? "0" : v.toFixed(1));

function ClientsTable({ clients }: { clients: ClientNow[] }) {
  if (clients.length === 0) {
    return <p className="text-sm text-white/40">No device is connected to either exit node right now.</p>;
  }
  return (
    <ul className="divide-y divide-white/5 rounded-lg border border-white/10 bg-white/[0.03]">
      {clients.map((c) => (
        <li key={`${c.node}/${c.device}`} className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-white/90">{c.device}</span>
              {c.os && <span className="text-xs text-white/35">{c.os}</span>}
              <span className="text-xs text-white/40">via {c.nodeLabel}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={PATH_TONE(c.path)}>{pathLabel(c.path)}</Badge>
              {c.endpoint && <span className="truncate text-xs text-white/35">{c.endpoint}</span>}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 text-right sm:contents">
            <div>
              <dt className="text-xs text-white/40">down / up</dt>
              <dd className="tabular-nums text-white/90">
                {mbps(c.downMbps)} / {mbps(c.upMbps)} <span className="text-xs text-white/35">Mbit/s</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">on DERP, last hour</dt>
              <dd className={`tabular-nums ${c.derpMinutesLastHour > 0 ? "text-amber-300" : "text-white/90"}`}>{c.derpMinutesLastHour} min</dd>
            </div>
            <div>
              <dt className="text-xs text-white/40">path changes, last hour</dt>
              <dd className={`tabular-nums ${c.pathChangesLastHour > 2 ? "text-amber-300" : "text-white/90"}`}>{c.pathChangesLastHour}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function PathEvents({ events }: { events: PathEvent[] }) {
  if (events.length === 0) return null;
  const shown = events.slice(0, EVENTS_SHOWN);
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-medium text-white/80">Path changes (24h)</h3>
        <p className="text-xs text-white/35">
          Every minute a device’s path to an exit node differed from the minute before. A session that drops shows as a path becoming idle.
        </p>
      </div>
      <ul className="space-y-1 text-sm">
        {shown.map((e) => (
          <li key={`${e.t}/${e.node}/${e.device}`} className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums text-xs text-white/40">
              {new Date(e.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="text-white/80">{e.device}</span>
            <Badge tone={PATH_TONE(e.from)}>{pathLabel(e.from)}</Badge>
            <span className="text-white/30">→</span>
            <Badge tone={isDerp(e.to) ? "warning" : PATH_TONE(e.to)}>{pathLabel(e.to)}</Badge>
          </li>
        ))}
        {events.length > shown.length && <li className="text-xs text-white/35">and {events.length - shown.length} more</li>}
      </ul>
    </section>
  );
}
