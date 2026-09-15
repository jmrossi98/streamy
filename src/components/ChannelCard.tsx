"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LiveChannel, LiveProgram } from "@/lib/liveTv";
import { ChannelWatchlistButton } from "@/components/ChannelWatchlistButton";

/**
 * Extracted from LiveTvContent so /watchlist can show the same card for a
 * saved channel that /live does -- a list-item style, not a poster thumbnail,
 * because unlike a movie or show a channel has no artwork of its own to
 * headline; what actually identifies it is its logo plus what's on now.
 */

/**
 * Local wall-clock time for a UTC instant.
 *
 * The server runs in UTC and the viewer does not, so this value is *meant* to
 * differ between the server render and the client one. That is a genuine
 * hydration mismatch rather than a bug, so it is marked as intentional at the
 * call site with suppressHydrationWarning -- which is cheaper and clearer than
 * a mount gate that renders the guide blank on first paint.
 */
function formatLocalTime(utc: string | null): string | null {
  if (!utc) return null;
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** How far through the current programme we are, 0-100, or null if unknowable. */
function progressPercent(program: LiveProgram | null, nowMs: number): number | null {
  if (!program?.startUtc || !program?.endUtc) return null;
  const start = new Date(program.startUtc).getTime();
  const end = new Date(program.endUtc).getTime();
  if (!(end > start)) return null;
  return Math.min(100, Math.max(0, ((nowMs - start) / (end - start)) * 100));
}

function ProgramLine({ program, label }: { program: LiveProgram | null; label: string }) {
  const start = formatLocalTime(program?.startUtc ?? null);
  if (!program) {
    return (
      <p className="truncate text-xs text-white/30">
        {label}: <span className="italic">no guide data</span>
      </p>
    );
  }
  return (
    <p className="truncate text-xs text-white/60">
      <span className="text-white/40">{label}:</span>{" "}
      {start && (
        <span suppressHydrationWarning className="tabular-nums text-white/40">
          {start}{" "}
        </span>
      )}
      <span className="text-white/80">{program.name}</span>
      {program.episodeTitle && <span className="text-white/50"> — {program.episodeTitle}</span>}
    </p>
  );
}

export function ChannelCard({ channel, inList }: { channel: LiveChannel; inList: boolean }) {
  // Ticks so the progress bar advances while the page is open -- a guide that
  // freezes the moment it renders is worse than no progress bar.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const pct = progressPercent(channel.now, nowMs);

  return (
    <Link
      href={`/live/${encodeURIComponent(channel.id)}`}
      className="flex w-full gap-3 rounded-lg border border-white/10 bg-netflix-dark/80 p-3 text-left transition-colors hover:border-white/40 hover:bg-netflix-dark focus:border-white/40 focus:outline-none"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-black/40">
        {channel.logoUrl ? (
          // Plain <img>: these are proxied through our own origin at an
          // arbitrary upstream size, and next/image would want a configured
          // remote pattern for a host that is Tailscale-only anyway.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={channel.logoUrl}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <span className="px-1 text-center text-[10px] font-semibold uppercase text-white/40">
            {channel.name.slice(0, 4)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {channel.number && (
            <span className="shrink-0 tabular-nums text-xs text-white/40">{channel.number}</span>
          )}
          <h3 className="truncate text-sm font-semibold text-white">{channel.name}</h3>
          <span className="ml-auto shrink-0">
            <ChannelWatchlistButton
              channelId={channel.id}
              name={channel.name}
              initialInList={inList}
              variant="circle"
            />
          </span>
          {channel.now?.isLive && (
            <span className="shrink-0 rounded bg-netflix-red/80 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              Live
            </span>
          )}
        </div>

        <div className="mt-1 space-y-0.5">
          <ProgramLine program={channel.now} label="Now" />
          <ProgramLine program={channel.next} label="Next" />
        </div>

        {pct !== null && (
          <div className="mt-2 h-0.5 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full bg-netflix-red" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </Link>
  );
}
