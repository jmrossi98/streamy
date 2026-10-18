"use client";

import { useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui";
import type { ViewerActivity, ViewerSessionView } from "@/lib/viewerActivity";

const POLL_MS = 10_000;

/**
 * Who is on Streamy, what they are watching, and whether it is working.
 *
 * Built from each signed-in tab's heartbeat and its players' events
 * (PresenceReporter, usePlaybackTelemetry), plus Dispatcharr's own view of
 * the provider lines. Polls while open. Answers what took an evening of
 * cross-referencing Caddy, Jellyfin and Dispatcharr logs on 2026-10-17.
 */
export function ViewerActivityPanel() {
  const [data, setData] = useState<ViewerActivity | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/admin/viewers", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: ViewerActivity) => {
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

  if (!data) return <p className="text-sm text-white/50">{failed ? "Couldn’t load viewer activity." : "Loading…"}</p>;

  const current = data.sessions.filter((s) => s.presence !== "offline");
  const earlier = data.sessions.filter((s) => s.presence === "offline");
  const playingCount = current.filter((s) => s.playing).length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-white/60">
        {current.filter((s) => s.presence === "online").length} online · {current.filter((s) => s.presence === "idle").length} idle ·{" "}
        {playingCount} playing
        <span className="ml-2 text-xs text-white/35">
          updated {new Date(data.generatedAt).toLocaleTimeString()}
          {failed && " · last refresh failed"}
        </span>
      </p>

      <ProviderLines data={data} />

      <div>
        <h3 className="mb-2 text-sm font-semibold text-white/80">On now</h3>
        {current.length === 0 ? (
          <p className="text-sm text-white/40">Nobody is on right now.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {current.map((s) => (
              <SessionCard key={s.id} s={s} now={data.generatedAt} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-white/80">Earlier today</h3>
        {earlier.length === 0 ? (
          <p className="text-sm text-white/40">No other sessions in the last 24 hours.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded border border-white/10">
            {earlier.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium text-white">{s.userName}</span>
                <span className="text-white/50">{s.device}</span>
                {s.location && <span className="text-white/40">{s.location}</span>}
                <span className="text-white/35">{ago(s.lastSeenAt, data.generatedAt)}</span>
                <HealthBadge s={s} />
                {s.health.lastError && <span className="w-full truncate text-xs text-red-300/80">{s.health.lastError}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProviderLines({ data }: { data: ViewerActivity }) {
  if (!data.lines && !data.connections) return null;
  const conns = data.connections ?? [];
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white/80">Provider lines</h3>
      <ul className="flex flex-wrap gap-2">
        {(data.lines ?? []).filter((l) => l.active).map((l) => {
          const using = conns.filter((c) => c.lineId === l.id);
          const busy = using.length > 0 || l.viewers > 0;
          return (
            <li key={`${l.provider}:${l.line}`} className="rounded border border-white/10 px-3 py-2 text-xs">
              <span className="font-medium text-white">{l.line}</span>{" "}
              <Badge tone={busy ? "warning" : "success"}>{busy ? `in use${l.maxStreams ? ` ${Math.max(using.length, l.viewers)}/${l.maxStreams}` : ""}` : "free"}</Badge>
              {using.map((c) => (
                <span key={c.channelName} className="mt-1 block text-white/60">
                  {c.channelName} · {c.state}
                  {c.uptimeSeconds != null && ` · ${Math.round(c.uptimeSeconds / 60)} min`}
                  {c.resolution && ` · ${c.resolution}`}
                  {c.kbps != null && ` · ${(c.kbps / 1000).toFixed(1)} Mbps`}
                  {c.speed != null && (
                    <span className={c.speed < 0.95 ? "text-amber-300" : undefined}>{` · ${c.speed.toFixed(2)}x`}</span>
                  )}
                  {c.clients === 0 && " · no viewer (retrying?)"}
                </span>
              ))}
            </li>
          );
        })}
        {/* A connection on a line the account list doesn't know about. */}
        {conns
          .filter((c) => !(data.lines ?? []).some((l) => l.id === c.lineId))
          .map((c) => (
            <li key={`x:${c.channelName}`} className="rounded border border-white/10 px-3 py-2 text-xs text-white/60">
              {c.lineId != null ? `line ${c.lineId}` : "unknown line"}: {c.channelName} · {c.state}
            </li>
          ))}
      </ul>
    </div>
  );
}

const STATE_TONE: Record<string, BadgeTone> = { playing: "success", tuning: "info", buffering: "warning", paused: "neutral", error: "danger" };

function SessionCard({ s, now }: { s: ViewerSessionView; now: number }) {
  const p = s.playing;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${s.presence === "online" ? "bg-emerald-400" : "bg-amber-400"}`} title={s.presence} />
        <span className="font-semibold text-white">{s.userName}</span>
        <span className="text-white/50">{s.device}</span>
        {s.location && <span className="text-white/40">{s.location}</span>}
        <span className="ml-auto"><HealthBadge s={s} /></span>
      </div>
      <p className="mt-1 truncate text-xs text-white/40" title={s.ip}>
        {s.path ?? "—"}
      </p>
      {p ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={STATE_TONE[p.state] ?? "neutral"}>{p.state}</Badge>
          <span className="truncate text-white/85">{p.title}</span>
          <span className="text-xs text-white/35">{Math.max(0, Math.round((now - p.since) / 60_000))} min</span>
          {p.error && <span className="w-full text-xs text-red-300">{p.error}</span>}
        </div>
      ) : (
        <p className="mt-2 text-xs text-white/40">Not playing anything</p>
      )}
      <HealthLine s={s} />
      {s.events.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-white/45 hover:text-white/70">Recent events ({s.events.length})</summary>
          <ol className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs">
            {[...s.events].reverse().map((e, i) => (
              <li key={i} className={e.kind === "error" || e.kind === "retry" ? "text-red-300/90" : e.kind === "stall" ? "text-amber-300/90" : "text-white/55"}>
                {new Date(e.at).toLocaleTimeString()} · {e.kind}
                {e.ms != null && ` ${(e.ms / 1000).toFixed(1)}s`} · {e.media}
                {e.detail && ` — ${e.detail}`}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function HealthLine({ s }: { s: ViewerSessionView }) {
  const h = s.health;
  if (h.verdict === "none") return null;
  return (
    <p className="mt-1 text-xs text-white/50">
      {h.starts} start{h.starts === 1 ? "" : "s"}
      {h.medianStartMs != null && ` · picture in ${(h.medianStartMs / 1000).toFixed(1)}s`}
      {` · ${h.stalls} stall${h.stalls === 1 ? "" : "s"}`}
      {h.stalls > 0 && ` (${(h.stallMs / 1000).toFixed(0)}s)`}
      {h.retries > 0 && ` · ${h.retries} retr${h.retries === 1 ? "y" : "ies"}`}
      {h.errors > 0 && ` · ${h.errors} error${h.errors === 1 ? "" : "s"}`}
    </p>
  );
}

function HealthBadge({ s }: { s: ViewerSessionView }) {
  const v = s.health.verdict;
  if (v === "none") return <Badge>browsing</Badge>;
  const tone: BadgeTone = v === "smooth" ? "success" : v === "rough" ? "warning" : "danger";
  const label = v === "smooth" ? "smooth" : v === "rough" ? "buffering" : "errors";
  return <Badge tone={tone}>{label}</Badge>;
}

function ago(at: number, now: number): string {
  const m = Math.round((now - at) / 60_000);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}
