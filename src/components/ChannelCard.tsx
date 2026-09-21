"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LiveChannel, LiveProgram } from "@/lib/liveTv";
import { WatchlistToggle } from "@/components/WatchlistToggle";
import type { ChannelInfo } from "@/lib/dispatcharr";

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

/**
 * One guide line, or nothing at all.
 *
 * Returns null rather than "Now: no guide data". This tuner is an M3U playlist
 * with no XMLTV source behind it, so *every* channel had two greyed-out lines
 * saying the same non-fact -- which is most of the card's height spent telling
 * the reader that there is nothing to tell them. A card with no guide is
 * simply a channel with a name, which is what it actually is.
 */
function ProgramLine({ program, label }: { program: LiveProgram | null; label: string }) {
  const start = formatLocalTime(program?.startUtc ?? null);
  if (!program) return null;
  return (
    <p className="truncate text-xs text-white/60">
      <span className="text-white/40">{label}:</span>{" "}
      {start && (
        <span suppressHydrationWarning className="tabular-nums text-white/40">
          {start}{" "}
        </span>
      )}
      <span className="text-white/80">{program.name}</span>
      {program.episodeTitle && <span className="text-white/50"> - {program.episodeTitle}</span>}
    </p>
  );
}

type Props = {
  channel: LiveChannel;
  inList: boolean;
  /**
   * Turns the card from a link into a checkbox toggle for bulk actions.
   * Navigation would fight with selecting a channel to hide, so the card
   * picks one job or the other rather than trying to support both at once.
   */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Provider and dead-stream state from Dispatcharr, when the join found it. */
  info?: ChannelInfo;
};

export function ChannelCard({ channel, inList, selectMode, selected, onToggleSelect, info }: Props) {
  // Ticks so the progress bar advances while the page is open -- a guide that
  // freezes the moment it renders is worse than no progress bar.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const pct = progressPercent(channel.now, nowMs);

  // items-center so the logo and the text block share a centre line. With the
  // guide lines gone for a tuner that has no EPG, the 56px logo is taller than
  // a single row of title text, and top-aligning left every card looking
  // top-heavy with dead space under the name.
  const className =
    "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors focus:outline-none " +
    (selectMode
      ? selected
        ? "border-netflix-red/70 bg-netflix-red/10"
        : "border-white/10 bg-netflix-dark/80 hover:border-white/30"
      : "border-white/10 bg-netflix-dark/80 hover:border-white/40 hover:bg-netflix-dark focus:border-white/40");

  const inner = (
    <>
      {selectMode && (
        <div className="flex shrink-0 items-center">
          <span
            aria-hidden
            className={
              "flex h-5 w-5 items-center justify-center rounded border text-xs font-bold " +
              (selected ? "border-netflix-red bg-netflix-red text-white" : "border-white/30 text-transparent")
            }
          >
            ✓
          </span>
        </div>
      )}
      <div
        className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded ${
          channel.logoUrl ? "bg-white p-1.5" : "bg-black/40"
        }`}
      >
        {channel.logoUrl ? (
          // A light backing plate, not the dark one the no-logo fallback
          // uses: a provider's logo is designed to sit on a white page --
          // several came through as a dark wordmark with no background of
          // its own, which read as an empty box against this app's dark
          // theme. Most logos already carry their own colour and lose
          // nothing sitting on white; the ones that were invisible before
          // are the ones this is actually for.
          //
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
        {/* items-center, not items-baseline: the number, the title and the
            My List button are different sizes, and baseline alignment left the
            round button visibly low against the text it sits beside. */}
        <div className="flex items-center gap-2">
          {channel.number && (
            <span className="shrink-0 tabular-nums text-xs text-white/40">{channel.number}</span>
          )}
          <h3 className="truncate text-sm font-semibold text-white">{channel.name}</h3>
          {!selectMode && (
            <span className="ml-auto shrink-0">
              <WatchlistToggle
                kind="channel"
                itemId={channel.id}
                extra={{ name: channel.name }}
                initialInList={inList}
                variant="badge"
              />
            </span>
          )}
          {channel.now?.isLive && (
            <span className="shrink-0 rounded bg-netflix-red/80 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              Live
            </span>
          )}
        </div>

        {/* Which provider this channel is on, and whether the provider has
            given up on the stream behind it. Absent, not "Unknown", when
            the join against Dispatcharr's own channel list found nothing --
            a missing label is quieter than a wrong one. */}
        {(info?.provider || info?.stale) && (
          <p className="truncate text-[11px] text-white/35">
            {info.provider}
            {info.provider && info.stale && " · "}
            {info.stale && <span className="text-amber-400/80">provider reports this as dead</span>}
          </p>
        )}

        {/* The wrapper goes too when there is nothing in it, otherwise every
            card keeps a margin reserved for absent guide lines and the row
            heights stay uneven for no visible reason. */}
        {(channel.now || channel.next) && (
          <div className="mt-1 space-y-0.5">
            <ProgramLine program={channel.now} label="Now" />
            <ProgramLine program={channel.next} label="Next" />
          </div>
        )}

        {pct !== null && (
          <div className="mt-2 h-0.5 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full bg-netflix-red" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </>
  );

  if (selectMode) {
    return (
      <button type="button" onClick={onToggleSelect} className={className} aria-pressed={!!selected}>
        {inner}
      </button>
    );
  }

  return (
    <Link href={`/live/${encodeURIComponent(channel.id)}`} className={className}>
      {inner}
    </Link>
  );
}
