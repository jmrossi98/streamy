"use client";

import { useEffect, useState } from "react";
import { Badge, type BadgeTone, scrollListClass } from "@/components/ui";
import type { HealthLevel, OnNowEntry, OnNowPlaying, StreamHealth } from "@/lib/onNowRules";
import type { ViewerActivity, ViewerSessionView } from "@/lib/viewerActivity";

const POLL_MS = 10_000;

/**
 * Who is streaming, what, how it is being served, and whether it is working.
 *
 * "On now" is every stream right now from every side: Streamy tabs (their
 * heartbeat and player events), Jellyfin's sessions (the Roku and the apps,
 * which never send a heartbeat), Dispatcharr's provider feed for a live
 * channel, and Streamy's own byte meter. One card per stream, failing ones
 * first, with a banner when anything is failing -- since 2026-10-24, when a
 * dead provider feed under the living-room Roku showed nothing here.
 * Polls while open.
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
  const onNow = data.onNow ?? [];
  const playingCount = onNow.filter((e) => e.playing).length;
  const appCount = onNow.filter((e) => e.via === "jellyfin").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-white/60">
        {current.filter((s) => s.presence === "online").length} online · {current.filter((s) => s.presence === "idle").length} idle ·{" "}
        {playingCount} playing
        {appCount > 0 && <span className="text-white/40"> ({appCount} on a Jellyfin app or device)</span>}
        <span className="ml-2 text-xs text-white/35">
          updated {new Date(data.generatedAt).toLocaleTimeString()}
          {failed && " · last refresh failed"}
        </span>
      </p>

      {(data.alerts ?? []).length > 0 && (
        <div role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <p className="font-semibold">
            {data.alerts.length} stream{data.alerts.length === 1 ? " is" : "s are"} failing
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-red-200/90">
            {data.alerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <ProviderLines data={data} />

      <div>
        <h3 className="mb-2 text-sm font-semibold text-white/80">On now</h3>
        {onNow.length === 0 ? (
          <p className="text-sm text-white/40">Nobody is on right now.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {onNow.map((e) => (
              <OnNowCard key={e.key} e={e} now={data.generatedAt} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-white/80">Earlier today</h3>
        {earlier.length === 0 ? (
          <p className="text-sm text-white/40">No other sessions in the last 24 hours.</p>
        ) : (
          <ul className={scrollListClass({}, "divide-y divide-white/5 rounded border border-white/10 pr-0")}>
            {earlier.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium text-white">{s.userName}</span>
                <span className="text-white/50">{s.device}</span>
                {s.location && <span className="text-white/40">{s.location}</span>}
                <span className="text-white/35">{ago(s.lastSeenAt, data.generatedAt)}</span>
                <HistoryBadge s={s} />
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
              {/* Provider first: a line named "Line 2" says nothing about whose
                  it is, and the next free line matters per provider. */}
              <span className="font-semibold text-white">{l.provider}</span>
              <span className="text-white/40"> · </span>
              <span className="font-medium text-white/80">{l.line}</span>{" "}
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
const KIND_LABEL: Record<OnNowPlaying["kind"], string> = {
  live: "Live",
  movie: "Movie",
  episode: "Episode",
  recording: "Recording",
  video: "Video",
};
const LEVEL_TONE: Record<HealthLevel, BadgeTone> = { ok: "success", warn: "warning", bad: "danger", unknown: "neutral" };
const LEVEL_TEXT: Record<HealthLevel, string> = { ok: "text-white/50", warn: "text-amber-300/90", bad: "text-red-300", unknown: "text-white/50" };

function OnNowCard({ e, now }: { e: OnNowEntry; now: number }) {
  const p = e.playing;
  const j = e.jellyfin;
  const f = e.feed;
  const tab = e.tab;
  return (
    <div className={`rounded-lg border p-3 text-sm ${e.health.level === "bad" ? "border-red-400/40 bg-red-500/[0.06]" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {tab ? (
          <span className={`h-2 w-2 rounded-full ${tab.presence === "online" ? "bg-emerald-400" : "bg-amber-400"}`} title={`Streamy tab · ${tab.presence}`} />
        ) : (
          <span className="h-2 w-2 rounded-full bg-sky-400" title="A Jellyfin app or device, not a Streamy tab" />
        )}
        <span className="font-semibold text-white">{e.userName}</span>
        <span className="text-white/50">{e.device}</span>
        {e.place && <span className="text-white/40">{e.place}</span>}
        <span className="ml-auto">
          <HealthBadge h={e.health} />
        </span>
      </div>
      {tab && (
        <p className="mt-1 truncate text-xs text-white/40">
          {tab.path ?? "—"} <span className="text-white/25">· {tab.ip}</span>
        </p>
      )}
      {!tab && e.ip && <p className="mt-1 truncate text-xs text-white/40">Jellyfin app <span className="text-white/25">· {e.ip}</span></p>}

      {p ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {p.state && <Badge tone={STATE_TONE[p.state] ?? "neutral"}>{p.state}</Badge>}
          <Badge tone="info">{KIND_LABEL[p.kind]}</Badge>
          <span className="truncate text-white/85">{p.title}</span>
          {p.since != null && <span className="text-xs text-white/35">{mins(now - p.since)} min</span>}
          {tab?.playing?.error && <span className="w-full text-xs text-red-300">{tab.playing.error}</span>}
        </div>
      ) : (
        <p className="mt-2 text-xs text-white/40">Not playing anything</p>
      )}

      {/* How Jellyfin is serving it. */}
      {j && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/50">
          <Badge tone={j.method === "transcode" ? "warning" : "neutral"} title={j.reasons.join(", ") || undefined}>
            {j.method}
            {j.output ? ` ${j.output}` : ""}
            {j.hwAccel ? ` · ${j.hwAccel}` : ""}
          </Badge>
          {j.fps != null && <span title="The transcoder's output frame rate">{j.fps} fps</span>}
          {j.mbps != null && !e.pipe && <span title="Jellyfin's target or source bitrate">{j.mbps.toFixed(1)} Mbit/s</span>}
          {j.paused && <Badge>paused</Badge>}
          {j.checkInAgeS != null && (
            <span className={j.checkInAgeS > 120 ? "text-amber-300/90" : undefined} title="When the player last reported progress to Jellyfin">
              checked in {j.checkInAgeS}s ago
            </span>
          )}
        </div>
      )}

      {/* The provider feed behind a live channel. */}
      {f && (
        <p className="mt-1 text-xs text-white/50">
          <span className="text-white/35">feed </span>
          <span className={f.state === "active" ? undefined : "text-amber-300/90"}>{f.state.replace(/_/g, " ")}</span>
          {f.speed != null && <span className={f.speed < 0.95 ? "text-amber-300" : undefined}>{` · ${f.speed.toFixed(2)}x`}</span>}
          {f.kbps != null && ` · ${(f.kbps / 1000).toFixed(1)} Mbps`}
          {f.resolution && ` · ${f.resolution}`}
          {f.uptimeSeconds != null && ` · up ${Math.round(f.uptimeSeconds / 60)} min`}
          {f.streamName && <span className="text-white/35">{` · ${f.streamName}`}</span>}
        </p>
      )}

      {/* What Streamy itself is piping. */}
      {e.pipe && (
        <p className="mt-1 text-xs text-white/50">
          <span className="text-white/35">through Streamy </span>
          <span className="tabular-nums text-white/80">{e.pipe.mbps.toFixed(1)} Mbit/s</span>
          {` · ${mins(now - e.pipe.since)} min · ${(e.pipe.bytes / 1e9).toFixed(2)} GB`}
        </p>
      )}

      {e.health.notes.length > 0 && (
        <ul className={`mt-1.5 space-y-0.5 text-xs ${LEVEL_TEXT[e.health.level]}`}>
          {e.health.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {tab && <HealthLine s={tab} />}
      {tab && tab.events.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-white/45 hover:text-white/70">Recent events ({tab.events.length})</summary>
          <ol className={scrollListClass({}, "mt-1 space-y-0.5 text-xs")}>
            {[...tab.events].reverse().map((ev, i) => (
              <li key={i} className={ev.kind === "error" || ev.kind === "retry" ? "text-red-300/90" : ev.kind === "stall" ? "text-amber-300/90" : "text-white/55"}>
                {new Date(ev.at).toLocaleTimeString()} · {ev.kind}
                {ev.ms != null && ` ${(ev.ms / 1000).toFixed(1)}s`} · {ev.media}
                {ev.detail && ` — ${ev.detail}`}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function HealthBadge({ h }: { h: StreamHealth }) {
  return (
    <Badge tone={LEVEL_TONE[h.level]} title={h.notes.join("\n") || "From the player, Jellyfin and the provider feed together"}>
      {h.level === "unknown" ? h.label : `playback: ${h.label}`}
    </Badge>
  );
}

/** The tab's own last-30-minutes tally: starts, time to first picture, stalls. */
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

/** For "Earlier today": how a finished session's playback went. */
function HistoryBadge({ s }: { s: ViewerSessionView }) {
  const v = s.health.verdict;
  if (v === "none") return <Badge>browsing</Badge>;
  const tone: BadgeTone = v === "smooth" ? "success" : v === "rough" ? "warning" : "danger";
  const label = v === "smooth" ? "playback: smooth" : v === "rough" ? "playback: stalling" : "playback: errors";
  return (
    <Badge tone={tone} title="How playback went over the last 30 minutes of the session (stalls of 1s or more, errors, failed starts)">
      {label}
    </Badge>
  );
}

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));

function ago(at: number, now: number): string {
  const m = Math.round((now - at) / 60_000);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}
