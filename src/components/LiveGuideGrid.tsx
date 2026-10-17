"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import type { LiveChannel } from "@/lib/liveTv";
import type { ChannelVerdict } from "@/lib/liveChannelRules";
import { Badge, cx } from "@/components/ui";
import {
  guideSlots,
  guideWindow,
  isAiring,
  layoutGuideRow,
  nowOffset,
  programsForChannel,
  slotStart,
  type GuideBlock,
  type GuideProgram,
} from "@/lib/liveGuideGrid";

/**
 * The clock the grid is drawn against, ticking every 30 seconds so the "now"
 * line and the highlighted programmes move while the page is open.
 *
 * null on the server, on purpose. Every position and label in the grid is a
 * function of the viewer's clock and time zone -- the server renders in UTC
 * -- so a server-drawn grid would be wrong for nearly everyone and then jump
 * on hydration. useSyncExternalStore's server snapshot gives a placeholder on
 * the first HTML and the real grid on the first client render, with no
 * hydration mismatch to suppress.
 */
const TICK_MS = 30_000;
function subscribeClock(onChange: () => void) {
  const t = setInterval(onChange, TICK_MS);
  return () => clearInterval(t);
}
const clockSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const serverClock = () => null;

function localTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A half-hour column's width. Narrower on a phone so more than one column fits beside the channels. */
const GRID_VARS = "[--slot:7.5rem] [--chan:7.5rem] md:[--slot:12rem] md:[--chan:13rem]";

type Props = {
  channels: LiveChannel[];
  /** guideKey(channel name) -> listings, from Dispatcharr's EPG. */
  guidePrograms: Record<string, GuideProgram[]>;
  statusByChannel: Record<string, ChannelVerdict>;
  logoFallbacks: Record<string, string>;
};

/**
 * A TV guide: channels down the left, half-hours across the top, each
 * programme a block as wide as it is long.
 *
 * The grid scrolls inside its own box in both directions -- that is what lets
 * the time header stick to the top and the channel column stick to the left
 * at the same time, and it keeps a six-hour-wide grid from ever widening the
 * page on a phone.
 */
export function LiveGuideGrid({ channels, guidePrograms, statusByChannel, logoFallbacks }: Props) {
  const nowMs = useSyncExternalStore(subscribeClock, clockSnapshot, serverClock);

  // Keyed on the half-hour, not the tick: the window only moves when the
  // clock crosses a column boundary, so the rows are laid out once per column.
  const startMs = nowMs == null ? null : slotStart(nowMs);
  const win = useMemo(() => (startMs == null ? null : guideWindow(startMs)), [startMs]);
  const rows = useMemo(
    () =>
      win
        ? channels.map((c) => ({ channel: c, blocks: layoutGuideRow(programsForChannel(c, guidePrograms), win) }))
        : [],
    [channels, guidePrograms, win]
  );

  if (nowMs == null || !win) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-white/10 bg-netflix-dark/60 text-sm text-white/40">
        Loading guide…
      </div>
    );
  }

  const slots = guideSlots(win);
  const nowAt = nowOffset(win, nowMs);
  const trackWidth = `calc(var(--slot) * ${slots.length})`;
  const nowLine =
    nowAt == null ? null : (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 z-[5] w-0.5 bg-netflix-red"
        style={{ left: `${nowAt * 100}%` }}
      />
    );

  return (
    <div
      className={cx(
        GRID_VARS,
        // Its own scroll box in both axes. max-h so the sticky header has
        // something to stick within; dvh so a phone's collapsing URL bar does
        // not leave the bottom row under it.
        "relative max-h-[calc(100dvh-13rem)] min-h-64 overflow-auto overscroll-x-contain rounded-lg border border-white/10 bg-netflix-dark/60"
      )}
      role="region"
      aria-label="TV guide"
      tabIndex={0}
    >
      <div className="w-max min-w-full">
        {/* Time header */}
        <div className="sticky top-0 z-20 flex border-b border-white/10 bg-netflix-black">
          <div
            className="sticky left-0 z-30 w-[var(--chan)] shrink-0 border-r border-white/10 bg-netflix-black px-2 py-2 text-xs font-semibold text-white/60"
          >
            {new Date(nowMs).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          </div>
          <div className="relative flex shrink-0" style={{ width: trackWidth }}>
            {slots.map((t) => (
              <div
                key={t}
                className="w-[var(--slot)] shrink-0 border-l border-white/10 px-2 py-2 text-xs font-medium tabular-nums text-white/70"
              >
                {localTime(t)}
              </div>
            ))}
            {nowLine}
          </div>
        </div>

        {rows.map(({ channel, blocks }) => (
          <div key={channel.id} className="flex border-b border-white/5">
            <ChannelCell
              channel={channel}
              status={statusByChannel[channel.name]}
              logoFallback={logoFallbacks[channel.name]}
            />
            <div className="relative h-16 shrink-0" style={{ width: trackWidth }}>
              {blocks.map((b) => (
                <ProgramBlock key={b.startMs} block={b} channel={channel} nowMs={nowMs} />
              ))}
              {nowLine}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function playerHref(channel: LiveChannel): string {
  // The same link a ChannelCard is: straight into that channel's player.
  return `/live/${encodeURIComponent(channel.id)}`;
}

function ChannelCell({
  channel, status, logoFallback,
}: { channel: LiveChannel; status?: ChannelVerdict; logoFallback?: string }) {
  const logo = channel.logoUrl || logoFallback;
  return (
    <Link
      href={playerHref(channel)}
      title={`Watch ${channel.name}`}
      className="sticky left-0 z-10 flex h-16 w-[var(--chan)] shrink-0 items-center gap-2 border-r border-white/10 bg-netflix-black px-2 transition-colors hover:bg-[#1f1f1f]"
    >
      <div
        className={cx(
          "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded md:h-10 md:w-10",
          logo ? "bg-white p-1" : "bg-black/40"
        )}
      >
        {logo ? (
          // Plain <img> for the same reason ChannelCard uses one: proxied
          // through our own origin at an arbitrary size.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <span className="px-0.5 text-center text-[9px] font-semibold uppercase text-white/40">
            {channel.name.slice(0, 4)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {channel.number && <div className="text-[11px] tabular-nums text-white/40">{channel.number}</div>}
        {/* Two lines, not one: channel names here run to "USA - FOX 31
            ROCHESTER NY (WUHF)", and a one-line truncation on a phone keeps
            only the "USA - F" that every channel shares. */}
        <div className="line-clamp-2 break-words text-xs font-medium leading-tight text-white/85">{channel.name}</div>
        {status?.state === "down" && (
          <Badge tone="danger" className="mt-0.5">
            Down
          </Badge>
        )}
      </div>
    </Link>
  );
}

function ProgramBlock({ block, channel, nowMs }: { block: GuideBlock; channel: LiveChannel; nowMs: number }) {
  const airing = isAiring(block, nowMs);
  const style = { left: `${block.offset * 100}%`, width: `${block.width * 100}%` };
  const base = "absolute inset-y-1 overflow-hidden rounded border px-2 py-1 text-left";

  const isProgram = block.kind === "program";
  const title = isProgram ? block.program.title : "No guide info";
  const time = isProgram
    ? `${block.clippedStart ? "Started " : ""}${localTime(Date.parse(block.program.startUtc))} – ${localTime(Date.parse(block.program.endUtc))}`
    : null;
  const subtitle = isProgram ? block.program.subtitle : null;

  const body = (
    <>
      <div className={cx("truncate text-xs font-semibold", isProgram ? "text-white" : "font-normal italic text-white/35")}>
        {isProgram && block.clippedStart && <span aria-hidden>‹ </span>}
        {title}
      </div>
      {time && <div className="truncate text-[11px] tabular-nums text-white/55">{time}</div>}
    </>
  );

  const tooltip = [title, time, subtitle].filter(Boolean).join("\n");
  const className = cx(
    base,
    // A sliver of a block (a 5-minute filler) keeps its border and tooltip
    // but no padding, which would otherwise push its text into the next one.
    block.width < 0.02 && "px-0.5",
    // Highlighted only when it is a programme: a full-width red "No guide
    // info" row shouts about the one thing the guide does not know. It still
    // links to the player when airing -- the channel is on, just unlisted.
    !isProgram
      ? cx("border-white/5 bg-transparent", airing && "hover:bg-white/[0.06]")
      : airing
        ? "border-netflix-red/60 bg-netflix-red/20 hover:bg-netflix-red/30"
        : "border-white/10 bg-white/[0.06]"
  );

  // Only what is on now opens the player -- tuning in to a programme that
  // starts in two hours would just play whatever is on before it.
  if (airing) {
    return (
      <Link href={playerHref(channel)} className={className} style={style} title={`Watch now\n${tooltip}`}>
        {body}
      </Link>
    );
  }
  return (
    <div className={className} style={style} title={tooltip}>
      {body}
    </div>
  );
}
