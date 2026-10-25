"use client";

import { useEffect, useRef, useState } from "react";
import { GAME_FEED_SEARCH_EVENT, type GameFeedSearchOutcome } from "@/lib/gameFeedSearch";
import type { LiveChannel } from "@/lib/liveTv";
import { LivePlayer } from "@/components/LivePlayer";
import type { ChannelInfo } from "@/lib/dispatcharr";
import { KEEPING_UP_SPEED } from "@/lib/liveChannelRules";
import { resolveStoredChoice, type StoredChoice } from "@/lib/gameChannelChoice";

type Props = {
  /** The best single match -- EPG-confirmed or a name-based guess, or null. */
  channel: LiveChannel | null;
  /** Whether `channel` is a real fact (Dispatcharr's EPG names both teams in what's airing right now) rather than a guess. */
  channelConfirmed: boolean;
  /** The ids of every option we actually know carries this game, so each is badged honestly -- not just the first. */
  confirmedIds?: string[];
  /** Channel name -> the team whose home market it is, when that is why it's confirmed (badge wording). */
  marketTeamByName?: Record<string, string>;
  /** Networks that plausibly carry this game's league, when there's no confident match. */
  candidates: LiveChannel[];
  /** Channel name -> provider and dead-stream state, best effort. */
  infoByChannel: Record<string, ChannelInfo>;
  /** Provider name -> free lines right now (Dispatcharr snapshot). Absent = unknown, treated as available. */
  providerFreeLines?: Record<string, number>;
  /** Channel name -> how fast its stream was last measured arriving (1 = real time). */
  speedByChannel?: Record<string, number>;
  /** This game's id, so a pick can be remembered against it. */
  fixtureId: string;
  /** What this user picked last time, if anything. Null for signed-out viewers. */
  storedChoice: StoredChoice | null;
  /**
   * Hold off playing while the page looks for the game's own feed, because
   * every option on offer is only a guess. Playing a guess straight away
   * took a provider line, so the stream probe refused to check the game's
   * feeds ("every line on this provider is in use") and nothing could be
   * added: on 2026-10-18 Bruins at Kings played MSG while ten dedicated feeds
   * went unchecked. Released when GameStreamFinder reports an outcome, when
   * the viewer picks a channel, or when the search goes quiet for
   * FEED_SEARCH_SILENCE_MS (or runs past FEED_SEARCH_LIMIT_MS in all). While
   * the finder keeps reporting progress the hold stands: every candidate is
   * checked before a guess plays (2026-10-25, Leeds at Sunderland played NBC
   * Sports Bay Area after 45 s with seven of its feeds unchecked).
   */
  holdForFeed?: boolean;
};

/**
 * Plays a game, with a channel switcher rather than a single fixed source.
 *
 * `channel` comes first when present, in one of two ways that get told apart
 * in the UI (`channelConfirmed`): a real fact from Dispatcharr's EPG (the
 * programme airing right now on that channel names both teams), or -- when
 * there's no EPG data to ask -- the same name-based guess this always made
 * (a channel promoted under one of the two teams' own names). `candidates`
 * are a looser guess still (a network that carries this game's league,
 * nothing more specific), offered because a guess beats nothing when there
 * is no better match, not because any one of them is known to be showing
 * this particular game.
 *
 * Switching channels changes only which id LivePlayer is handed. Its own tune
 * effect is keyed on channelId, so it already tears down the old HLS session
 * and Jellyfin tune and starts a fresh one on a change -- nothing here has to
 * reimplement that.
 *
 * A pick is remembered per user against this fixture. The reason it has to be
 * is that the first option is a guess: when it's wrong -- a dead stream, the
 * wrong regional feed -- switching away is a correction, and a correction that
 * a reload throws away is one you make again at every ad break. The stored
 * pick beats `channel` precisely because the person overrode `channel` once
 * already.
 */
/** How long the feed search may go without reporting a checked stream before a guess plays. */
const FEED_SEARCH_SILENCE_MS = 60_000;
/** The longest a game page holds off playing in all, however many feeds are left to check. */
const FEED_SEARCH_LIMIT_MS = 4 * 60_000;

export function GameChannelPicker({
  channel,
  channelConfirmed,
  confirmedIds = [],
  marketTeamByName = {},
  candidates,
  infoByChannel,
  providerFreeLines = {},
  speedByChannel = {},
  fixtureId,
  storedChoice,
  holdForFeed = false,
}: Props) {
  const [held, setHeld] = useState(holdForFeed);
  /** How far the feed search has got, while it reports (GameStreamFinder). */
  const [searchProgress, setSearchProgress] = useState<{ checked: number; total: number } | null>(null);
  /** Bumped on each progress report, so the silence timer starts over. */
  const [searchBeat, setSearchBeat] = useState(0);
  /** Why a guess is playing instead of the game's feed, once the search is over or out of time. */
  const [searchEnd, setSearchEnd] = useState<"none" | "timeout" | null>(null);
  /** When the hold began, for the overall limit; set by the hold effect, never during render. */
  const heldSince = useRef<number | null>(null);
  /** Feeds added this visit, listed at once rather than after a reload. */
  const [added, setAdded] = useState<LiveChannel[]>([]);
  const serverOptions = channel ? [channel, ...candidates] : candidates;
  const options = [...added.filter((a) => !serverOptions.some((o) => o.id === a.id)), ...serverOptions];
  const remembered = resolveStoredChoice(serverOptions, storedChoice);
  const [selectedId, setSelectedId] = useState<string | null>(
    // The remembered pick if it's still in the lineup, otherwise the best
    // match. resolveStoredChoice returns null on a miss rather than guessing.
    (remembered ?? serverOptions[0])?.id ?? null
  );
  /** Channels that already failed to start this visit, so the fallback never loops. */
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  /** Providers found at capacity this visit (a 503 on tune), so we don't keep trying their channels. */
  const [fullProviders, setFullProviders] = useState<string[]>([]);
  /** Set when every option left is on a provider with no free line -- shown instead of spinning forever. */
  const [noLines, setNoLines] = useState(false);
  /** The viewer chose (now or on an earlier visit): nothing switches it for them after that. */
  const [userPicked, setUserPicked] = useState(remembered != null);

  // A better default from a refresh is taken up, unless the viewer chose.
  const defaultId = channel?.id ?? null;
  const [lastDefault, setLastDefault] = useState(defaultId);
  if (defaultId !== lastDefault) {
    setLastDefault(defaultId);
    if (!userPicked && defaultId) {
      setSelectedId(defaultId);
      setHeld(false);
    }
  }

  useEffect(() => {
    const onOutcome = (e: Event) => {
      const d = (e as CustomEvent<GameFeedSearchOutcome>).detail;
      if (d?.fixtureId !== fixtureId) return;
      if (d.outcome === "checking") {
        setSearchProgress(d.progress ?? null);
        setSearchBeat((n) => n + 1);
        return;
      }
      if (d.outcome === "none") {
        setHeld((wasHeld) => {
          if (wasHeld) setSearchEnd("none");
          return false;
        });
        return;
      }
      if (!d.channel) return;
      // Into the list now, and -- added automatically, with no choice of the
      // viewer's in the way -- into the player now. No reload.
      const ch: LiveChannel = { id: d.channel.id, name: d.channel.name, number: null, logoUrl: null, now: null, next: null };
      setAdded((prev) => (prev.some((p) => p.id === ch.id) ? prev : [ch, ...prev]));
      if (!d.manual && !userPicked) {
        setSelectedId(ch.id);
        setHeld(false);
        setSearchEnd(null);
        setFallbackNote(null);
      }
    };
    window.addEventListener(GAME_FEED_SEARCH_EVENT, onOutcome);
    return () => window.removeEventListener(GAME_FEED_SEARCH_EVENT, onOutcome);
  }, [fixtureId, userPicked]);

  useEffect(() => {
    if (!held) return;
    heldSince.current ??= Date.now();
    const left = FEED_SEARCH_LIMIT_MS - (Date.now() - heldSince.current);
    const limit = setTimeout(
      () => {
        setSearchEnd("timeout");
        setHeld(false);
      },
      Math.max(0, Math.min(FEED_SEARCH_SILENCE_MS, left))
    );
    return () => clearTimeout(limit);
    // searchBeat: a progress report starts the silence timer over.
  }, [held, searchBeat]);

  const selected = options.find((c) => c.id === selectedId) ?? options[0] ?? null;

  const providerOf = (c: LiveChannel): string | null => infoByChannel[c.name]?.provider ?? null;
  /** A provider is unusable when we hit its capacity this visit, or the snapshot shows no free line. */
  const providerFull = (provider: string | null, full: Set<string>): boolean =>
    provider != null && (full.has(provider) || (providerFreeLines[provider] ?? 1) <= 0);

  /**
   * A channel that never started, after its own retries: move on. When it
   * failed because its provider had no free line ("busy"), that whole provider
   * is skipped -- its other channels would fail the same way -- and we switch to
   * one on a provider that still has a line. When nothing is left on an
   * available provider, say so at once rather than spin on a channel we already
   * know can't start. Not remembered as the viewer's pick -- it was ours.
   */
  function giveUpOn(dead: LiveChannel, reason?: "busy" | "offline") {
    const failed = [...failedIds, dead.id];
    setFailedIds(failed);
    const deadProvider = providerOf(dead);
    const full = new Set(fullProviders);
    if (reason === "busy" && deadProvider) full.add(deadProvider);
    setFullProviders([...full]);

    const usable = options
      .filter((c) => !failed.includes(c.id) && !providerFull(providerOf(c), full))
      // A provider with a known free line ahead of one whose capacity we can't see.
      .sort((a, b) => (providerFreeLines[providerOf(b) ?? ""] ?? 0) - (providerFreeLines[providerOf(a) ?? ""] ?? 0));
    const next = usable[0];
    if (!next) {
      // Everything left is on a provider at capacity (or there's nothing left).
      setNoLines(options.some((c) => !failed.includes(c.id)));
      setFallbackNote(null);
      return;
    }
    setNoLines(false);
    setFallbackNote(
      reason === "busy" && deadProvider
        ? `${deadProvider} is at capacity (all its lines are in use), so we switched to ${next.name}.`
        : `${dead.name} didn’t start, so we switched to ${next.name}.`
    );
    setSelectedId(next.id);
  }

  /**
   * Optimistic on purpose: the switch has already happened in the player, and
   * a failed write costs a remembered preference, not the thing being watched.
   * Blocking the tune on a round trip would be the worse trade.
   */
  function pick(c: LiveChannel) {
    setHeld(false);
    setSearchEnd(null);
    setUserPicked(true);
    setSelectedId(c.id);
    setFallbackNote(null);
    // A deliberate pick is a fresh go: it may be on a provider we'd given up on,
    // and a line may have freed since.
    setNoLines(false);
    setFailedIds((f) => f.filter((id) => id !== c.id));
    void fetch("/api/live/game-channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixtureId, channelId: c.id, name: c.name }),
    }).catch(() => {});
  }

  if (!selected && !held) {
    return (
      <div className="rounded-lg border border-white/10 bg-netflix-dark/60 px-4 py-10 text-center">
        <p className="text-base font-semibold text-white/80">No channel available</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
          Nothing in the current lineup looks like it&rsquo;s carrying this game. Check back closer
          to kickoff, or browse the full channel list from Live TV.
        </p>
      </div>
    );
  }

  return (
    <div>
      {noLines ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-black px-6 text-center">
          <p className="text-base font-semibold text-white/85">All lines are in use</p>
          <p className="max-w-md text-sm text-white/55">
            Every provider that could carry this game is at capacity right now. A line frees up when
            another stream ends. Pick a channel below to try again, or come back shortly.
          </p>
          <button
            type="button"
            onClick={() => {
              setNoLines(false);
              setFailedIds([]);
              setFullProviders([]);
              setHeld(false);
            }}
            className="mt-1 rounded bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
          >
            Try again
          </button>
        </div>
      ) : held || !selected ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-black text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
          <p className="text-sm text-white/70">Finding the game&rsquo;s own stream…</p>
          <p className="max-w-sm px-4 text-xs text-white/40">
            Nothing in the lineup is confirmed to carry this game, so the providers&rsquo; streams for it are being
            checked one by one
            {searchProgress && searchProgress.total > 0 && (
              <>
                {" "}
                ({searchProgress.checked} of {searchProgress.total} done)
              </>
            )}
            . Pick a channel below to watch one of them now instead.
          </p>
        </div>
      ) : (
        <LivePlayer
          channelId={selected.id}
          channelName={selected.name}
          nowPlaying={selected.now?.name ?? null}
          onGiveUp={(reason) => giveUpOn(selected, reason)}
        />
      )}
      {fallbackNote && <p className="mt-3 text-sm text-amber-300/90">{fallbackNote}</p>}
      {/* A guess is playing, and the viewer didn't choose it: say why, so a
          49ers pregame show on a Leeds page isn't a mystery (2026-10-25). */}
      {searchEnd && !userPicked && selected && !held && !noLines && (
        <p className="mt-3 text-sm text-amber-300/90">
          {searchEnd === "none"
            ? `None of the providers' streams for this game played, so ${selected.name} is on instead. It's a guess at a channel that might carry the game, not a confirmed one.`
            : `The game's own stream is still being looked for, so ${selected.name} is on meanwhile. It's a guess at a channel that might carry the game; the player switches if a feed turns up.`}
        </p>
      )}

      {/* Shown even with one option, so the channel playing is always named
          here -- an auto-added feed used to appear nowhere (2026-10-18). */}
      {options.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-white/70">
            {options.length === 1 ? "Channel" : channel ? "Also on" : "Might be on"}
          </h2>
          <ul className="space-y-1.5">
            {options.map((c, i) => {
              const isSelected = c.id === selected.id;
              // Only the single best match earns a badge, and only when
              // it's actually one of the options -- the badge is a claim
              // about the match, not about being first in the list.
              const isBestMatch = channel != null && i === 0;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? "bg-netflix-red/15 ring-1 ring-netflix-red/50"
                        : "bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    {c.number && (
                      <span className="shrink-0 tabular-nums text-xs text-white/40">{c.number}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-white/90">
                      {c.name}
                      {infoByChannel[c.name]?.provider && (
                        <span className="ml-2 text-xs text-white/35">
                          {infoByChannel[c.name].provider}
                        </span>
                      )}
                    </span>
                    {/* Why this one is down here rather than at the top: the
                        provider has marked it dead. Still clickable -- the
                        flag can lag a stream that came back, and a dead
                        option beats no option when it is the only one. */}
                    {/* Only said when it was measured: a stream that cannot
                        deliver a second of picture per second buffers and
                        drifts behind live. */}
                    {speedByChannel[c.name] != null &&
                      (speedByChannel[c.name] >= KEEPING_UP_SPEED ? (
                        <span
                          className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400/80"
                          title="Arriving in real time when last measured"
                        >
                          Smooth
                        </span>
                      ) : (
                        <span
                          className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300"
                          title="Arriving slower than real time when last measured, so it buffers and falls behind live"
                        >
                          Slow {speedByChannel[c.name].toFixed(2)}×
                        </span>
                      ))}
                    {infoByChannel[c.name]?.stale && (
                      <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                        Dead
                      </span>
                    )}
                    {confirmedIds.includes(c.id) ? (
                      <span
                        className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400"
                        title={
                          marketTeamByName[c.name]
                            ? `${marketTeamByName[c.name]} home market — this market always gets its team's game on the carrying network`
                            : "The guide names this game here, or it's the single national feed the game is on"
                        }
                      >
                        {marketTeamByName[c.name] ? "In market" : "Confirmed"}
                      </span>
                    ) : (
                      isBestMatch && (
                        <span
                          className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/60"
                          title="The closest match in the lineup, but not confirmed to be showing this game"
                        >
                          Best match
                        </span>
                      )
                    )}
                    {/* "Playing" only while the player is actually on it: during
                        the feed search the row is the fallback, not what's on. */}
                    {isSelected &&
                      (held || noLines ? (
                        <span
                          className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/60"
                          title="Plays only if the game's own stream can't be found"
                        >
                          Fallback
                        </span>
                      ) : (
                        <span className="shrink-0 rounded bg-netflix-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          Playing
                        </span>
                      ))}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
