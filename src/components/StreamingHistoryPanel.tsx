"use client";

import { useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import type { StreamingHistory } from "@/app/api/admin/streaming/history/route";
import type { TrendBucket } from "@/lib/stallTrendRules";

const REFRESH_MS = 5 * 60_000;

/**
 * How streaming has been going: stalls by the hour over the last day, the
 * day's load on the line, and a month of daily peaks -- the number that says
 * when the next provider line or a bigger pipe starts to matter.
 */
export function StreamingHistoryPanel() {
  const [data, setData] = useState<StreamingHistory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/admin/streaming/history", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: StreamingHistory) => {
          if (!live) return;
          setData(d);
          setFailed(false);
        })
        .catch(() => live && setFailed(true));
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (!data) return <p className="text-sm text-white/50">{failed ? "Couldn’t read the history." : "Loading…"}</p>;

  return (
    <div className="space-y-8">
      <StallTrend data={data} />
      <DayLoad data={data} />
      <DailyPeaks data={data} />
    </div>
  );
}

const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric" });

function StallTrend({ data }: { data: StreamingHistory }) {
  const s = data.stallSummary;
  const rate = s.stallsPerTenStarts;
  const tone: BadgeTone = rate == null ? "neutral" : rate >= 5 ? "danger" : rate >= 2 ? "warning" : "success";
  const maxStalls = Math.max(1, ...data.stalls.map((b) => b.stalls));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <h3 className="font-semibold text-white/80">Stalls, last 24 hours</h3>
        <Badge tone={tone} title="Stalls of a second or more, per ten playback starts">
          {rate == null ? "no playback" : `${rate} per 10 starts`}
        </Badge>
        <span className="text-white/50">
          {s.starts} start{s.starts === 1 ? "" : "s"} · {s.stalls} stall{s.stalls === 1 ? "" : "s"} ({s.stallSeconds}s) · {s.errors} error{s.errors === 1 ? "" : "s"}
        </span>
        {s.worst && (
          <span className="text-xs text-white/40">
            worst hour {hourFmt.format(new Date(s.worst.start))}: {s.worst.stalls} stalls, {s.worst.stallSeconds}s
          </span>
        )}
      </div>
      <ol className="flex h-16 items-end gap-px" aria-label="Stalls per hour">
        {data.stalls.map((b) => (
          <HourBar key={b.start} b={b} max={maxStalls} />
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-[10px] text-white/30">
        <span>{hourFmt.format(new Date(data.stalls[0].start))}</span>
        <span>{hourFmt.format(new Date(data.stalls[data.stalls.length - 1].start))}</span>
      </div>
    </div>
  );
}

function HourBar({ b, max }: { b: TrendBucket; max: number }) {
  const h = b.stalls === 0 ? 2 : Math.max(4, Math.round((b.stalls / max) * 100));
  const color = b.errors > 0 ? "bg-red-400/80" : b.stalls > 0 ? "bg-amber-400/80" : b.starts > 0 ? "bg-emerald-400/50" : "bg-white/10";
  const title = `${hourFmt.format(new Date(b.start))}: ${b.starts} starts, ${b.stalls} stalls (${b.stallSeconds}s), ${b.errors} errors${
    b.medianStartMs != null ? `, picture in ${(b.medianStartMs / 1000).toFixed(1)}s` : ""
  }`;
  return <li className={`flex-1 rounded-t ${color}`} style={{ height: `${h}%` }} title={title} />;
}

function DayLoad({ data }: { data: StreamingHistory }) {
  if (data.samples.length < 2) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold text-white/80">Load, last 24 hours</h3>
        <p className="text-sm text-white/40">Not enough samples yet — one is taken a minute while anyone is on.</p>
      </div>
    );
  }
  const times = data.samples.map((s) => new Date(s.at).toISOString());
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-white/80">Streams playing, last 24 hours</h3>
        <TimeSeriesChart
          times={times}
          unit="count"
          height={120}
          series={[
            { label: "Playing", values: data.samples.map((s) => s.playing) },
            { label: "Live TV", values: data.samples.map((s) => s.live) },
          ]}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-white/80">Upload line, last 24 hours</h3>
        <TimeSeriesChart
          times={times}
          unit="megabitsPerSecond"
          height={140}
          series={[
            { label: "Streamy viewers", values: data.samples.map((s) => s.proxyMbps) },
            { label: "Torrent seeding", values: data.samples.map((s) => s.torrentUpMbps) },
          ]}
        />
      </div>
    </div>
  );
}

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

function DailyPeaks({ data }: { data: StreamingHistory }) {
  const peaks = data.peaks.slice(-30);
  if (peaks.length === 0) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold text-white/80">Busiest moment each day</h3>
        <p className="text-sm text-white/40">No days recorded yet.</p>
      </div>
    );
  }
  const maxPlaying = Math.max(1, ...peaks.map((p) => p.peakPlaying));
  const monthPeak = peaks.reduce((a, p) => (p.peakPlaying > a.peakPlaying ? p : a), peaks[0]);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <h3 className="font-semibold text-white/80">Busiest moment each day</h3>
        <span className="text-white/50">
          peak {monthPeak.peakPlaying} at once on {dayFmt.format(new Date(`${monthPeak.day}T00:00:00Z`))} ({monthPeak.peakMbps} Mbit/s)
        </span>
      </div>
      <ol className="flex h-20 items-end gap-px" aria-label="Peak simultaneous streams per day">
        {peaks.map((p) => (
          <li
            key={p.day}
            className={`flex-1 rounded-t ${p.peakPlaying >= 4 ? "bg-red-400/80" : p.peakPlaying >= 3 ? "bg-amber-400/80" : "bg-sky-400/70"}`}
            style={{ height: `${Math.max(3, (p.peakPlaying / maxPlaying) * 100)}%` }}
            title={`${dayFmt.format(new Date(`${p.day}T00:00:00Z`))}: ${p.peakPlaying} at once, ${p.peakMbps} Mbit/s, ${Math.round(p.busyMinutes / 60 * 10) / 10} h with someone watching`}
          />
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-[10px] text-white/30">
        <span>{dayFmt.format(new Date(`${peaks[0].day}T00:00:00Z`))}</span>
        <span>{dayFmt.format(new Date(`${peaks[peaks.length - 1].day}T00:00:00Z`))}</span>
      </div>
      <p className="mt-2 text-xs text-white/35">Three at once goes amber, four red: that is when the fourth line and the upload budget matter.</p>
    </div>
  );
}
