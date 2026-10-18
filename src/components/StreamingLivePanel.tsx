"use client";

import { useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui";
import type { StreamingNow } from "@/lib/streamingNow";
import type { HeadroomLevel, HeadroomPart } from "@/lib/streamingHeadroomRules";
import { NVENC_SESSION_LIMIT, STALE_AFTER_S } from "@/lib/boxVitals";

const POLL_MS = 10_000;
/** A 1080p transcode, the rung every Streamy viewer who isn't direct-playing gets. */
const VIEWER_MBPS = 8;

/**
 * Is there room for one more viewer, and if playback is rough, whose fault is it.
 *
 * Four cards: the upload line (the one budget every remote viewer shares),
 * the streams on it, mediabox (CPU, GPU, what stream-priority has throttled)
 * and the Lightsail proxy. Polls while open and visible.
 */
export function StreamingLivePanel() {
  const [data, setData] = useState<StreamingNow | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/admin/streaming", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: StreamingNow) => {
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

  if (!data) return <p className="text-sm text-white/50">{failed ? "Couldn’t read the streaming state." : "Loading…"}</p>;

  return (
    <div className="space-y-6">
      <p className="text-xs text-white/35">
        updated {new Date(data.generatedAt).toLocaleTimeString()}
        {failed && " · last refresh failed"}
      </p>
      <HeadroomCard data={data} />
      <StreamsCard data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <BoxCard data={data} />
        <ProxyCard data={data} />
      </div>
    </div>
  );
}

const LEVEL_TONE: Record<HeadroomLevel, BadgeTone> = { ok: "success", tight: "warning", saturated: "danger" };
const LEVEL_LABEL: Record<HeadroomLevel, string> = { ok: "room to spare", tight: "getting tight", saturated: "saturated" };
const PART_COLOR: Record<HeadroomPart["kind"], string> = { streams: "bg-sky-400", jellyfin: "bg-emerald-400", torrent: "bg-amber-400" };

function HeadroomCard({ data }: { data: StreamingNow }) {
  const h = data.headroom;
  const moreViewers = Math.floor(h.freeMbps / VIEWER_MBPS);
  return (
    <Card title="Upload line">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold text-white">
          {h.usedMbps.toFixed(1)} <span className="text-base font-normal text-white/50">of {h.budgetMbps} Mbit/s</span>
        </span>
        <Badge tone={LEVEL_TONE[h.level]}>{LEVEL_LABEL[h.level]}</Badge>
        <span className="text-sm text-white/55">
          {moreViewers === 0 ? "no room for another 1080p viewer" : `room for ${moreViewers} more 1080p viewer${moreViewers === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="relative mt-3 h-3 w-full overflow-hidden rounded bg-white/10" role="img" aria-label={`${h.usedPct}% of the upload line in use`}>
        <div className="flex h-full">
          {h.parts.map((p) => (
            <div key={p.kind} className={`${PART_COLOR[p.kind]} h-full`} style={{ width: `${Math.min(100, (p.mbps / h.budgetMbps) * 100)}%` }} title={`${p.label}: ${p.mbps} Mbit/s`} />
          ))}
        </div>
        {/* Where "saturated" begins. */}
        <div className="absolute inset-y-0 w-px bg-red-300/70" style={{ left: "85%" }} title="85%: where a new viewer starts to be a gamble" />
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/60">
        {h.parts.map((p) => (
          <li key={p.kind} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-sm ${PART_COLOR[p.kind]}`} />
            {p.label} <span className="text-white/85">{p.mbps.toFixed(1)}</span>
          </li>
        ))}
        {data.box?.net.primary.txMbps != null && (
          <li className="text-white/40" title="What the box's network card is actually sending, everything included">
            NIC out {data.box.net.primary.txMbps.toFixed(1)} · to the proxy {data.box.net.tailscale?.txMbps.toFixed(1) ?? "?"}
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-white/35">
        Every Streamy stream leaves the house over this line, even from the couch. Measured 2026-10-18: a 1080p transcode is ~8, a 4K direct play 40–60.
      </p>
    </Card>
  );
}

const KIND_LABEL = { live: "Live", movie: "Movie", episode: "Episode", recording: "Recording" } as const;
const WHERE_LABEL = { lan: "at home", tailnet: "via Streamy", remote: "away", unknown: "?" } as const;
const WHERE_TONE: Record<string, BadgeTone> = { lan: "neutral", tailnet: "info", remote: "warning", unknown: "neutral" };

function StreamsCard({ data }: { data: StreamingNow }) {
  // Streamy's own viewers already appear as metered streams; Jellyfin's view
  // of the same people would list them twice.
  const apps = (data.jellyfinSessions ?? []).filter((s) => s.where !== "tailnet");
  if (data.streams.length === 0 && apps.length === 0) {
    return (
      <Card title="Streams">
        <p className="text-sm text-white/40">Nothing is streaming right now.</p>
      </Card>
    );
  }
  return (
    <Card title={`Streams (${data.streams.length + apps.length})`}>
      <ul className="divide-y divide-white/5">
        {data.streams.map((s) => (
          <li key={`${s.user}|${s.kind}|${s.ref}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="font-medium text-white">{s.user}</span>
            <Badge tone="info">{KIND_LABEL[s.kind]}</Badge>
            <span className="truncate text-white/80">{s.title ?? <span className="text-white/40">{s.ref.slice(0, 8)}…</span>}</span>
            <span className="ml-auto tabular-nums text-white/85">{s.mbps.toFixed(1)} Mbit/s</span>
            <span className="tabular-nums text-xs text-white/40">
              {mins(data.generatedAt - s.since)} min · {(s.bytes / 1e9).toFixed(2)} GB
            </span>
          </li>
        ))}
        {apps.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="font-medium text-white">{s.user}</span>
            <Badge tone={WHERE_TONE[s.where]}>{WHERE_LABEL[s.where]}</Badge>
            <span className="text-white/50">{[s.client, s.device].filter(Boolean).join(" · ")}</span>
            <span className="truncate text-white/80">{s.title}</span>
            <Badge tone={s.method === "transcode" ? "warning" : "neutral"} title={s.reasons.join(", ") || undefined}>
              {s.method}
              {s.output ? ` ${s.output}` : ""}
            </Badge>
            {s.paused && <Badge>paused</Badge>}
            <span className="ml-auto tabular-nums text-white/85">{s.mbps != null ? `${s.mbps.toFixed(1)} Mbit/s` : "—"}</span>
          </li>
        ))}
      </ul>
      {apps.some((s) => s.where === "lan") && (
        <p className="mt-2 text-xs text-white/35">Viewers at home play straight off mediabox and don’t use the upload line.</p>
      )}
    </Card>
  );
}

function BoxCard({ data }: { data: StreamingNow }) {
  const b = data.box;
  if (!b) {
    return (
      <Card title="mediabox">
        <p className="text-sm text-white/40">No vitals published yet — is box-vitals.py running on the box?</p>
      </Card>
    );
  }
  const stale = (data.boxAgeSeconds ?? 0) > STALE_AFTER_S;
  const sp = b.streamPriority;
  const busy = b.cpu.busyPct ?? 0;
  const iow = b.cpu.iowaitPct ?? 0;
  const memUsedPct = b.memory.totalBytes ? Math.round(((b.memory.totalBytes - b.memory.availableBytes) / b.memory.totalBytes) * 100) : 0;
  return (
    <Card
      title="mediabox"
      aside={stale ? <Badge tone="danger">stale · {Math.round((data.boxAgeSeconds ?? 0) / 60)} min old</Badge> : <span className="text-xs text-white/35">{data.boxAgeSeconds}s ago</span>}
    >
      <div className="mb-3">
        {sp ? (
          sp.throttled ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="warning">background work throttled</Badge>
              <span className="text-white/60">since {sp.since ? new Date(sp.since).toLocaleTimeString() : "?"}</span>
              <span className="w-full text-xs text-white/50">
                {[
                  sp.paused.length > 0 && `paused ${sp.paused.join(", ")}`,
                  sp.loweredCpuWeight.length > 0 && `${sp.loweredCpuWeight.length} containers at 1/10 CPU weight`,
                  sp.sabSpeedLimited && "SAB slowed",
                  sp.sabDiskLimited && "SAB disk capped",
                  sp.qbtDownloadLimited && "torrent downloads capped",
                  sp.cancelledTasks.length > 0 && `cancelled ${sp.cancelledTasks.join(", ")}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success">background work at full speed</Badge>
              {sp.secondsSincePlaying != null && <span className="text-xs text-white/40">last stream {ago(sp.secondsSincePlaying)}</span>}
            </div>
          )
        ) : (
          <span className="text-xs text-white/40">stream-priority state unknown</span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Stat label="CPU busy" value={`${busy.toFixed(0)}%`} warn={busy >= 85} hint={`${b.cpu.cores} threads · load ${b.cpu.load1}`} />
        <Stat label="I/O wait" value={`${iow.toFixed(0)}%`} warn={iow >= 30} hint="time cores sat waiting on disks" />
        <Stat label="Memory" value={`${memUsedPct}%`} warn={memUsedPct >= 90} hint={`swap ${(b.memory.swapUsedBytes / 1e9).toFixed(1)} GB`} />
        {b.gpu ? (
          <>
            <Stat
              label="NVENC sessions"
              value={`${b.gpu.nvencSessions} / ${NVENC_SESSION_LIMIT}`}
              warn={b.gpu.nvencSessions >= NVENC_SESSION_LIMIT - 1}
              hint={`encoder ${b.gpu.encoderPct}% · decoder ${b.gpu.decoderPct}%`}
            />
            <Stat label="GPU" value={`${b.gpu.utilPct}%`} hint={`${b.gpu.temperatureC}°C · ${b.gpu.memoryUsedMB} MB`} />
          </>
        ) : (
          <Stat label="GPU" value="—" hint="not readable" />
        )}
        <Stat
          label="Transcodes"
          value={`${b.ffmpeg.live + b.ffmpeg.vod}`}
          hint={`${b.ffmpeg.live} live · ${b.ffmpeg.vod} VOD · ${b.ffmpeg.other} other ffmpeg`}
        />
        {Object.entries(b.disks).map(([name, d]) => (
          <Stat
            key={name}
            label={name === "sda" ? "SSD" : name === "sdb" ? "HDD" : name}
            value={`${d.busyPct.toFixed(0)}% busy`}
            warn={d.busyPct >= 80}
            hint={`${d.readMBps.toFixed(1)} r · ${d.writeMBps.toFixed(1)} w MB/s`}
          />
        ))}
        <Stat
          label="Transcode cache"
          value={b.transcodeCache ? `${(b.transcodeCache.bytes / 1e9).toFixed(2)} GB` : "—"}
          warn={(b.transcodeCache?.bytes ?? 0) > 20e9}
          hint={b.transcodeCache ? `${b.transcodeCache.files} files` : undefined}
        />
        <Stat label="CPU temp" value={b.cpu.temperatureC != null ? `${b.cpu.temperatureC}°C` : "—"} warn={(b.cpu.temperatureC ?? 0) >= 85} hint={b.zombies > 0 ? `${b.zombies} zombie processes` : undefined} />
      </dl>
      {b.containers.top.length > 0 && (
        <p className="mt-3 text-xs text-white/50">
          <span className="text-white/35">CPU by container: </span>
          {b.containers.top.map((c) => `${c.name} ${c.cpuPct.toFixed(0)}%`).join(" · ")}
        </p>
      )}
    </Card>
  );
}

function ProxyCard({ data }: { data: StreamingNow }) {
  const n = data.node;
  const hostUsedPct = Math.round(((n.hostTotalBytes - n.hostFreeBytes) / n.hostTotalBytes) * 100);
  return (
    <Card title="Streamy server (Lightsail)" aside={<span className="text-xs text-white/35">up {days(n.uptimeSeconds)}</span>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Stat label="Node CPU" value={n.cpuPct != null ? `${n.cpuPct.toFixed(0)}%` : "—"} warn={(n.cpuPct ?? 0) >= 80} hint={`of one core · host load ${n.load1} on ${n.hostCores}`} />
        <Stat
          label="Event loop lag"
          value={`${n.eventLoopP99Ms.toFixed(0)} ms`}
          warn={n.eventLoopP99Ms >= 100}
          hint={`p99 · median ${n.eventLoopP50Ms.toFixed(0)} · max ${n.eventLoopMaxMs.toFixed(0)}`}
        />
        <Stat label="Memory" value={`${(n.rssBytes / 1e6).toFixed(0)} MB`} warn={n.rssBytes > 1.2e9} hint={`heap ${(n.heapUsedBytes / 1e6).toFixed(0)} / ${(n.heapTotalBytes / 1e6).toFixed(0)} MB · host ${hostUsedPct}% used`} />
        <Stat label="Proxied streams" value={`${data.streams.length}`} hint={`${data.headroom.parts[0].mbps.toFixed(1)} Mbit/s through Node`} />
        <Stat label="Torrent" value={data.torrent ? `${data.torrent.upMbps.toFixed(1)} up` : "—"} hint={data.torrent ? `${data.torrent.dlMbps.toFixed(1)} Mbit/s down` : "qBittorrent unreachable"} />
        <Stat label="Node" value={n.nodeVersion} />
      </dl>
      <p className="mt-3 text-xs text-white/35">
        A t3.small: two vCPUs on CPU credits. Sustained Node CPU above ~20% per core eats the credit balance, after which the VM is throttled.
      </p>
    </Card>
  );
}

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white/80">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-white/40">{label}</dt>
      <dd className={`tabular-nums ${warn ? "text-amber-300" : "text-white/90"}`}>{value}</dd>
      {hint && <dd className="text-xs text-white/35">{hint}</dd>}
    </div>
  );
}

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));
const ago = (s: number) => (s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`);
const days = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 172_800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86_400)} d`);
