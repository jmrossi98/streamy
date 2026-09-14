"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiveChannel, LiveProgram } from "@/lib/liveTv";
import Link from "next/link";
import { ChannelWatchlistButton } from "@/components/ChannelWatchlistButton";
import { ROW_H2_CLASS } from "@/lib/browseLayout";

type Props = {
  /** JELLYFIN_URL/JELLYFIN_API_KEY are set. */
  envSet: boolean;
  /** Jellyfin actually answered a probe -- the server is up, not just configured. */
  reachable: boolean;
  channels: LiveChannel[];
  /** The fetch hit its cap -- there are more channels than are shown. */
  truncated: boolean;
  /** Channel ids on this viewer's My List. Pinned above everything else. */
  myListIds: string[];
};

/** Rendered at once. Enough to scroll, few enough to stay responsive. */
const PAGE_SIZE = 60;

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

function ChannelCard({ channel, inList }: { channel: LiveChannel; inList: boolean }) {
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

export function LiveTvContent({ envSet, reachable, channels, truncated, myListIds }: Props) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    // Number as well as name: on a broadcast lineup people reach for "7.1"
    // as readily as for the call sign.
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.number ?? "").toLowerCase().includes(q) ||
        (c.now?.name ?? "").toLowerCase().includes(q)
    );
  }, [channels, query]);

  const listed = new Set(myListIds);
  // Pinned above the rest, and excluded from search so it stays a stable
  // shelf rather than disappearing the moment someone types.
  const mine = channels.filter((c) => listed.has(c.id));
  const visible = filtered.slice(0, shown);

  // The three states are deliberately distinguished. "Jellyfin is unreachable",
  // "Jellyfin is fine but has no tuner", and "there's a tuner but it returned
  // nothing" have completely different fixes, and collapsing them into one
  // empty state is what makes a feature feel broken rather than unconfigured.
  let empty: { title: string; detail: React.ReactNode } | null = null;
  if (!envSet) {
    empty = {
      title: "Live TV isn’t configured",
      detail: (
        <>
          <code className="text-white/70">JELLYFIN_URL</code> or{" "}
          <code className="text-white/70">JELLYFIN_API_KEY</code> is unset on the server.
        </>
      ),
    };
  } else if (!reachable) {
    // Distinct from "no tuner" on purpose. Reporting a downed server as a
    // missing tuner sends you to check the wrong thing entirely.
    empty = {
      title: "Jellyfin isn’t responding",
      detail:
        "Streamy is configured for Jellyfin but the server isn’t answering. " +
        "Check that the Jellyfin container is running.",
    };
  } else if (channels.length === 0) {
    // Deliberately one state, not two. Telling "no tuner" apart from "tuner
    // that hasn't scanned" needs a signal Jellyfin doesn't cheaply expose, and
    // guessing at one is what produced a confidently wrong message before.
    empty = {
      title: "No channels",
      detail: (
        <>
          Jellyfin is running but returned no channels. Check that a tuner is added under{" "}
          <span className="text-white/70">Dashboard → Live TV → Tuner Devices</span>, and that
          it has finished scanning.
        </>
      ),
    };
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className={ROW_H2_CLASS}>Live TV</h1>
        {channels.length > 0 && (
          <span className="text-sm text-white/40">
            {query ? `${filtered.length} of ${channels.length}` : `${channels.length} channel${channels.length === 1 ? "" : "s"}`}
            {truncated && !query ? "+" : ""}
          </span>
        )}
      </div>

      {channels.length > PAGE_SIZE && (
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Reset paging here rather than in an effect: it is a consequence
            // of the edit, not of the render. Without it the reveal count from
            // the previous search carries over and results look arbitrarily
            // long.
            setShown(PAGE_SIZE);
          }}
          placeholder="Search channels…"
          // text-base on mobile: iOS zooms the viewport on a focused input
          // under 16px and there is no way back out without pinching.
          className="mb-4 w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-base text-white placeholder-white/30 focus:border-white/40 focus:outline-none sm:text-sm"
        />
      )}

      {empty ? (
        <div className="rounded-lg border border-white/10 bg-netflix-dark/60 px-4 py-10 text-center">
          <p className="text-base font-semibold text-white/80">{empty.title}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/50">{empty.detail}</p>
        </div>
      ) : (
        <>
          {mine.length > 0 && !query && (
            <section className="mb-8">
              <h2 className="mb-3 font-display text-xl font-bold text-white">My Stations</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mine.map((c) => (
                  <ChannelCard key={`mine:${c.id}`} channel={c} inList />
                ))}
              </div>
            </section>
          )}

          {mine.length > 0 && !query && (
            <h2 className="mb-3 font-display text-xl font-bold text-white">All Channels</h2>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((c) => (
              <ChannelCard key={c.id} channel={c} inList={listed.has(c.id)} />
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-white/40">
              No channels match “{query}”.
            </p>
          )}

          {shown < filtered.length && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE_SIZE)}
                className="rounded bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
              >
                Show {Math.min(PAGE_SIZE, filtered.length - shown)} more
              </button>
            </div>
          )}

          {truncated && !query && shown >= filtered.length && (
            // Said out loud rather than silently cutting the list off, which
            // is what the old hard cap did.
            <p className="mt-4 text-center text-xs text-white/30">
              Showing the first {channels.length} channels. Your tuner reports more —
              narrow the playlist in Jellyfin if you need the rest.
            </p>
          )}
        </>
      )}

    </div>
  );
}
